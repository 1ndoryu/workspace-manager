/* Rutas de la tab vps (/api/vps/*): despliegues Coolify en solo lectura.
 * [por que] Mismo patron que rutasRepos.ts: el puente (puente.ts) ejecuta,
 * respuestasVps.ts parsea y aqui solo se enruta/responde. Parseo estricto
 * del texto humano del manager (list/health/audit/logs no tienen --json):
 * lo no reconocido es 'desconocido', nunca un estado inventado. Devuelve
 * true si atendio. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { json } from '../../http.js';
import type { VpsAviso, VpsConfig, VpsDetalle, VpsPieza, VpsSitio } from '../../../shared/types.js';
import { agenteProd, enriquecerConSitios, type InfoSitio } from '../agente.js';
import { historialProd } from '../historial.js';
import {
  auditoria,
  dbStatsJson,
  diagnoseJson,
  eventosJson,
  dondeBuscarBinario,
  inspectJson,
  listarSitios,
  logs,
  NOMBRE_OK,
  rutaBinario,
  rutaConfigDespliegue,
  salud,
  statsJson,
  versionBinario,
} from '../puente.js';
import { parsearListado, pieza, resumirAuditoria, sanearJson } from '../respuestasVps.js';

/* Nombres vistos en el ultimo /sitios: el /detalle exige pertenencia cuando
 * hay lista (anti-sondeo de nombres ajenos); sin lista previa, regex. */
let nombresConocidos: string[] | null = null;

/* Mapa uuid→sitio para resolver nombres legibles en /agente (los
 * contenedores Coolify son `app-{uuid}`). Cache 10 min, refresco en
 * segundo plano: el /agente nunca espera al `list` (lento en frio). */
let mapaSitios: Map<string, InfoSitio> = new Map();
let mapaSitiosTs = 0;
const MAPA_SITIOS_MS = 600_000;

/* Listado de sitios: dos llamadas al CLI de la VPS (básico y detallado), cada una del orden de
 * un segundo. [por que] Sin caché cada petición del tablero las relanzaba: medido 2–3 s por
 * petición, y lo mismo al repetirla. Se guarda 20 s y, si ya vuela, la llamada se comparte; no
 * se guarda si el listado básico falló, para no servir un error como dato. */
const SITIOS_TTL_MS = 20_000;
let listadoSitios: { ts: number; datos: [VpsPieza, VpsPieza] } | null = null;
let vueloSitios: Promise<[VpsPieza, VpsPieza]> | null = null;

function listadoSitiosCacheado(): Promise<[VpsPieza, VpsPieza]> {
  if (listadoSitios && Date.now() - listadoSitios.ts < SITIOS_TTL_MS) return Promise.resolve(listadoSitios.datos);
  vueloSitios ??= (async (): Promise<[VpsPieza, VpsPieza]> => {
    const datos: [VpsPieza, VpsPieza] = await Promise.all([
      pieza(() => listarSitios(false), true),
      pieza(() => listarSitios(true), true),
    ]);
    if (datos[0].ok) listadoSitios = { ts: Date.now(), datos };
    return datos;
  })().finally(() => {
    vueloSitios = null;
  });
  return vueloSitios;
}

/* Semilla local desde settings.json (nombre/dominio/stackUuid por sitio):
 * instantanea y completa sin SSH ni binario. Solo se extraen esos tres
 * campos: los secretos del archivo jamas salen de aqui. La ruta se resuelve
 * desde este archivo (no desde cwd: el backend puede arrancar en otra
 * carpeta y la semilla fallaba en silencio). */
function sembrarMapaSettings(): void {
  /* [por que] El fichero del gestor de despliegues lo resuelve su unico dueno
   * (`rutaConfigDespliegue` en puente.ts): es el MISMO que recibe el binario con
   * `-c`, asi que no pueden divergir — antes la semilla miraba el fichero del
   * proyecto y el binario solo la variable, y sin variable el panel avisaba de
   * una VPS inalcanzable que estaba perfectamente viva. Sin papel ni variable no
   * hay ruta y esta semilla no existe. */
  const ruta = rutaConfigDespliegue();
  if (!ruta) return;
  try {
    const cfg = JSON.parse(readFileSync(ruta, 'utf8')) as {
      sitios?: { nombre?: unknown; dominio?: unknown; stackUuid?: unknown }[];
    };
    if (!Array.isArray(cfg.sitios)) return;
    for (const s of cfg.sitios) {
      if (typeof s?.stackUuid === 'string' && s.stackUuid && typeof s?.nombre === 'string') {
        mapaSitios.set(s.stackUuid, {
          nombre: s.nombre,
          dominio: typeof s.dominio === 'string' ? s.dominio : '',
        });
      }
    }
    if (mapaSitios.size > 0) mapaSitiosTs = Date.now();
  } catch {
    /* Fichero ilegible: sin semilla local; el mapa se llena con el binario. */
  }
}

function refrescarMapaSitios(): void {
  if (!rutaBinario()) return;
  listarSitios(false)
    .then((texto) => {
      /* Fusión sobre la semilla (settings trae los 13 sitios; el list en
       * vivo solo devuelve los 8 del manager legacy): lo vivo manda, lo
       * demás se conserva. Antes se reemplazaba y 5 despliegues
       * (agape, task, restaurante-perf, inmobiliaria, pulse) caían a
       * infra con el `app-{uuid}` crudo. */
      sembrarMapaSettings();
      for (const s of parsearListado(String(texto), false)) {
        if (s.uuid) mapaSitios.set(s.uuid, { nombre: s.nombre, dominio: s.dominio });
      }
      if (mapaSitios.size > 0) {
        mapaSitiosTs = Date.now();
      }
    })
    .catch(() => {});
}

export function leerRefreshMs(): number {
  const n = Number.parseInt(process.env.VPS_REFRESH_MS ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* Siembra y refresca el mapa uuid→sitio si está vacío o caducado. [por que] Lo
 * necesitan /agente y /agente-detalle; antes cada uno llevaba el mismo bloque. */
function asegurarMapaSitios(): void {
  if (mapaSitios.size === 0) {
    sembrarMapaSettings();
  }
  if (mapaSitios.size === 0 || Date.now() - mapaSitiosTs > MAPA_SITIOS_MS) {
    refrescarMapaSitios();
  }
}

async function responderConfig(res: ServerResponse): Promise<void> {
  const rutaBin = rutaBinario();
  const config: VpsConfig = {
    refreshMs: leerRefreshMs(),
    binario: {
      ruta: rutaBin ?? '(no encontrado)',
      version: rutaBin ? await versionBinario() : null,
      ok: rutaBin !== null,
    },
  };
  json(res, 200, config);
}

/* Snapshot del agente glory-pulse (299A-12 F2): una sola conexión. Sin
 * PULSE_URL/PULSE_TOKEN el frontend usa legacy (`sin-configurar`). El
 * token jamás viaja al frontend (vive en agente.ts). */
async function responderAgente(res: ServerResponse): Promise<void> {
  const agente = agenteProd();
  if (!agente) {
    json(res, 200, { disponible: false, snapshot: null, error: 'sin-configurar' });
    return;
  }
  asegurarMapaSitios();
  const r = await agente.snapshot();
  if (r.disponible && r.snapshot) {
    const contenedores = enriquecerConSitios(r.snapshot.contenedores, mapaSitios);
    /* [07AA-4] Persiste las sumas por sitio de lo YA servido (cero
     * consultas extra; best-effort, nunca rompe la respuesta). */
    historialProd().anotar(contenedores, r.snapshot.ts);
    json(res, 200, {
      ...r,
      snapshot: { ...r.snapshot, contenedores },
    });
    return;
  }
  json(res, 200, r);
}

/* [309A-2] Detalle por sitio en una conexión: proxy a
 * `GET /detalle?sitio=<uuid>` del agente. `uuid` fail-closed (misma
 * regla que pulse: alfanumérico; el nombre legible lo resuelve el
 * frontend desde su lista de sitios). Sin agente, `sin-configurar` y
 * el llamante usa legacy. El legacy `/detalle` queda intacto. */
async function responderAgenteDetalle(res: ServerResponse, url: URL): Promise<void> {
  const uuid = url.searchParams.get('uuid') ?? '';
  if (!/^[A-Za-z0-9]{1,64}$/.test(uuid)) {
    json(res, 400, { error: 'uuid-invalido' });
    return;
  }
  const agente = agenteProd();
  if (!agente) {
    json(res, 200, { disponible: false, detalle: null, error: 'sin-configurar' });
    return;
  }
  asegurarMapaSitios();
  const r = await agente.detalleSitio(uuid);
  if (r.disponible && r.detalle) {
    json(res, 200, {
      ...r,
      detalle: {
        ...r.detalle,
        contenedores: enriquecerConSitios(r.detalle.contenedores, mapaSitios),
      },
    });
    return;
  }
  json(res, 200, r);
}

async function responderSitios(res: ServerResponse): Promise<void> {
  if (!rutaBinario()) {
    json(res, 503, { error: 'sin-binario', ayuda: dondeBuscarBinario() });
    return;
  }
  const [base, detalle] = await listadoSitiosCacheado();
  const filas = base.ok ? parsearListado(String(base.datos), false) : [];
  const reales = new Map(
    (detalle.ok ? parsearListado(String(detalle.datos), true) : []).map((s) => [s.nombre, s]),
  );
  const sitios: VpsSitio[] = [];
  const avisos: VpsAviso[] = [];
  for (const s of filas) {
    const real = reales.get(s.nombre);
    const estado = real?.estadoReal ?? '';
    const estadoReal = estado || (s.uuid ? 'desconocido' : 'sin-asignar');
    sitios.push({ ...s, estadoReal });
    if (!s.uuid) avisos.push({ nombre: s.nombre, problema: 'sin-asignar' });
    else if (!estado) {
      avisos.push({
        nombre: s.nombre,
        problema: reales.size === 0 ? 'sin-estado-real' : 'estado-desconocido',
      });
    }
  }
  nombresConocidos = sitios.map((s) => s.nombre);
  const aviso =
    !base.ok && !detalle.ok
      ? 'no se pudo leer el listado (¿VPS inalcanzable?)'
      : !detalle.ok
        ? 'sin estado real: el detallado fallo, los estados son desconocidos'
        : null;
  json(res, 200, { sitios, avisos, aviso });
}

async function responderDetalle(res: ServerResponse, url: URL): Promise<void> {
  const sitio = url.searchParams.get('sitio') ?? '';
  if (!NOMBRE_OK.test(sitio)) {
    json(res, 400, { error: 'nombre-invalido', sitio });
    return;
  }
  if (nombresConocidos && !nombresConocidos.includes(sitio)) {
    json(res, 404, { error: 'sitio-desconocido', sitio });
    return;
  }
  if (!rutaBinario()) {
    json(res, 503, { error: 'sin-binario' });
    return;
  }
  /* Serie (el puente ya encola a 1): cada pieza cae por separado. El JSON
   * se sanea de secretos antes de responder (el visor lo muestra todo). */
  const detalle: VpsDetalle = {
    sitio,
    piezas: {
      salud: await pieza(() => salud(sitio), true),
      stats: await pieza(async () => sanearJson(await statsJson(sitio))),
      inspeccion: await pieza(async () => sanearJson(await inspectJson(sitio))),
      eventos: await pieza(async () => sanearJson(await eventosJson(sitio))),
      bd: await pieza(async () => sanearJson(await dbStatsJson(sitio))),
      diagnostico: await pieza(async () => sanearJson(await diagnoseJson(sitio))),
      logs: await pieza(() => logs(sitio, 100), true),
    },
  };
  json(res, 200, detalle);
}

async function responderRecursos(res: ServerResponse): Promise<void> {
  if (!rutaBinario()) {
    json(res, 503, { error: 'sin-binario' });
    return;
  }
  const texto = await pieza(() => auditoria(), true);
  const resumen: VpsPieza = texto.ok ? resumirAuditoria(String(texto.datos)) : {
    ok: false,
    datos: null,
    error: 'sin-metricas',
  };
  json(res, 200, { piezas: { resumen, texto } });
}

/* Tabla ruta → respuesta. [por que] Añadir un endpoint es una línea aquí y no otro `if`
 * dentro de `manejarRutasVps` (principio abierto/cerrado). */
type Responder = (res: ServerResponse, url: URL) => Promise<void>;

const RESPUESTAS = new Map<string, Responder>([
  ['/api/vps/config', (res) => responderConfig(res)],
  ['/api/vps/agente', (res) => responderAgente(res)],
  ['/api/vps/agente-detalle', (res, url) => responderAgenteDetalle(res, url)],
  ['/api/vps/sitios', (res) => responderSitios(res)],
  ['/api/vps/detalle', (res, url) => responderDetalle(res, url)],
  ['/api/vps/recursos', (res) => responderRecursos(res)],
]);

export async function manejarRutasVps(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  const responder = RESPUESTAS.get(ruta);
  if (!responder) return false;
  await responder(res, url);
  return true;
}
