/* Rutas de la tab vps (/api/vps/*): despliegues Coolify en solo lectura.
 * [por que] Mismo patron que rutasRepos.ts: el puente (puente.ts) ejecuta y
 * aqui solo se parsea/responde. Parseo estricto del texto humano del manager
 * (list/health/audit/logs no tienen --json): lo no reconocido es
 * 'desconocido', nunca un estado inventado. Devuelve true si atendio. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json } from '../http.js';
import type { VpsAviso, VpsConfig, VpsDetalle, VpsPieza, VpsSitio } from '../../shared/types.js';
import { agenteProd, enriquecerConSitios, type InfoSitio } from './agente.js';
import {
  auditoria,
  dbStatsJson,
  diagnoseJson,
  eventosJson,
  inspectJson,
  listarSitios,
  logs,
  NOMBRE_OK,
  redactar,
  rutaBinario,
  salud,
  statsJson,
  versionBinario,
} from './puente.js';
const MAX_TEXTO = 4000;
/* Claves cuyo valor nunca viaja al frontend (el --json puede traer env con
 * secretos y el visor generico lo mostraria todo). */
const CLAVE_SECRETA = /api[_-]?key|token|secret|password|passwd|authorization/i;

function sanearJson(v: unknown): unknown {
  if (typeof v === 'string') return redactar(v);
  if (Array.isArray(v)) return v.map(sanearJson);
  if (v && typeof v === 'object') {
    const limpio: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      limpio[k] = CLAVE_SECRETA.test(k) ? '···' : sanearJson(val);
    }
    return limpio;
  }
  return v;
}

/* Nombres vistos en el ultimo /sitios: el /detalle exige pertenencia cuando
 * hay lista (anti-sondeo de nombres ajenos); sin lista previa, regex. */
let nombresConocidos: string[] | null = null;

/* Mapa uuid→sitio para resolver nombres legibles en /agente (los
 * contenedores Coolify son `app-{uuid}`). Cache 10 min, refresco en
 * segundo plano: el /agente nunca espera al `list` (lento en frio). */
let mapaSitios: Map<string, InfoSitio> = new Map();
let mapaSitiosTs = 0;
const MAPA_SITIOS_MS = 600_000;

/* Semilla local desde settings.json (nombre/dominio/stackUuid por sitio):
 * instantanea y completa sin SSH ni binario. Solo se extraen esos tres
 * campos: los secretos del archivo jamas salen de aqui. La ruta se resuelve
 * desde este archivo (no desde cwd: el backend puede arrancar en otra
 * carpeta y la semilla fallaba en silencio). */
const RAIZ_REPO = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
function sembrarMapaSettings(): void {
  const candidatos = [
    (process.env.COOLIFY_MANAGER_CONFIG ?? '').trim(),
    join(RAIZ_REPO, '..', 'coolify-manager-rs', 'config', 'settings.json'),
  ].filter((r) => r && existsSync(r));
  for (const ruta of candidatos) {
    try {
      const cfg = JSON.parse(readFileSync(ruta, 'utf8')) as {
        sitios?: { nombre?: unknown; dominio?: unknown; stackUuid?: unknown }[];
      };
      if (!Array.isArray(cfg.sitios)) continue;
      for (const s of cfg.sitios) {
        if (typeof s?.stackUuid === 'string' && s.stackUuid && typeof s?.nombre === 'string') {
          mapaSitios.set(s.stackUuid, {
            nombre: s.nombre,
            dominio: typeof s.dominio === 'string' ? s.dominio : '',
          });
        }
      }
      if (mapaSitios.size > 0) {
        mapaSitiosTs = Date.now();
        return;
      }
    } catch {
      /* Siguiente candidato. */
    }
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

function recortar(texto: string): string {
  const t = texto.trim();
  return t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO)}\n…(recortado)` : t;
}

/* Parsea la tabla NOMBRE DOMINIO TARGET «STACK UUID» [ESTADO] del `list`:
 * columnas por posicion del header (separador 2+ espacios; el header del
 * UUID es "STACK UUID", asi que se busca por inclusion). Filas que no
 * cuadran se saltan (la seccion Minecraft tiene otra forma). */
function parsearListado(texto: string, conEstado: boolean): VpsSitio[] {
  const lineas = texto.split('\n');
  const cab = lineas.findIndex((l) => /NOMBRE/.test(l) && /DOMINIO/.test(l));
  if (cab < 0) return [];
  const cols = lineas[cab].split(/\s{2,}/).map((c) => c.trim());
  const i = (n: string) => cols.findIndex((c) => c.includes(n));
  const iNombre = i('NOMBRE');
  const iDominio = i('DOMINIO');
  const iTarget = i('TARGET');
  const iUuid = i('UUID');
  const iEstado = i('ESTADO');
  if (iNombre < 0) return [];
  const sitios: VpsSitio[] = [];
  for (const l of lineas.slice(cab + 1)) {
    if (!l.trim() || /^(Minecraft|─|═|=)/i.test(l.trim())) continue;
    const c = l.split(/\s{2,}/).map((x) => x.trim());
    const nombre = c[iNombre] ?? '';
    if (!nombre || !NOMBRE_OK.test(nombre)) continue;
    sitios.push({
      nombre,
      dominio: iDominio >= 0 ? (c[iDominio] ?? '') : '',
      target: iTarget >= 0 ? (c[iTarget] ?? '') : '',
      uuid: iUuid >= 0 ? (c[iUuid] ?? '') : '',
      estadoReal: conEstado && iEstado >= 0 && c[iEstado] ? c[iEstado] : '',
    });
  }
  return sitios;
}

async function pieza<T>(fn: () => Promise<T>, texto = false): Promise<VpsPieza> {
  try {
    const datos = await fn();
    return {
      ok: true,
      datos: texto && typeof datos === 'string' ? recortar(datos) : datos,
      error: null,
    };
  } catch (err) {
    return { ok: false, datos: null, error: String(err).slice(0, 200) };
  }
}

export async function manejarRutasVps(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  if (ruta === '/api/vps/config') {
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
    return true;
  }

  /* Snapshot del agente glory-pulse (299A-12 F2): una sola conexión. Sin
   * PULSE_URL/PULSE_TOKEN el frontend usa legacy (`sin-configurar`). El
   * token jamás viaja al frontend (vive en agente.ts). */
  if (ruta === '/api/vps/agente') {
    const agente = agenteProd();
    if (!agente) {
      json(res, 200, { disponible: false, snapshot: null, error: 'sin-configurar' });
      return true;
    }
    if (mapaSitios.size === 0) {
      sembrarMapaSettings();
    }
    if (mapaSitios.size === 0 || Date.now() - mapaSitiosTs > MAPA_SITIOS_MS) {
      refrescarMapaSitios();
    }
    const r = await agente.snapshot();
    if (r.disponible && r.snapshot) {
      json(res, 200, {
        ...r,
        snapshot: {
          ...r.snapshot,
          contenedores: enriquecerConSitios(r.snapshot.contenedores, mapaSitios),
        },
      });
      return true;
    }
    json(res, 200, r);
    return true;
  }

  /* [309A-2] Detalle por sitio en una conexión: proxy a
   * `GET /detalle?sitio=<uuid>` del agente. `uuid` fail-closed (misma
   * regla que pulse: alfanumérico; el nombre legible lo resuelve el
   * frontend desde su lista de sitios). Sin agente, `sin-configurar` y
   * el llamante usa legacy. El legacy `/detalle` queda intacto. */
  if (ruta === '/api/vps/agente-detalle') {
    const uuid = url.searchParams.get('uuid') ?? '';
    if (!/^[A-Za-z0-9]{1,64}$/.test(uuid)) {
      json(res, 400, { error: 'uuid-invalido' });
      return true;
    }
    const agente = agenteProd();
    if (!agente) {
      json(res, 200, { disponible: false, detalle: null, error: 'sin-configurar' });
      return true;
    }
    if (mapaSitios.size === 0) {
      sembrarMapaSettings();
    }
    if (mapaSitios.size === 0 || Date.now() - mapaSitiosTs > MAPA_SITIOS_MS) {
      refrescarMapaSitios();
    }
    const r = await agente.detalleSitio(uuid);
    if (r.disponible && r.detalle) {
      json(res, 200, {
        ...r,
        detalle: {
          ...r.detalle,
          contenedores: enriquecerConSitios(r.detalle.contenedores, mapaSitios),
        },
      });
      return true;
    }
    json(res, 200, r);
    return true;
  }

  if (ruta === '/api/vps/sitios') {
    if (!rutaBinario()) {
      json(res, 503, { error: 'sin-binario', ayuda: 'COOLIFY_MANAGER_BIN o C:\\Users\\Owner\\bin' });
      return true;
    }
    const [base, detalle] = await Promise.all([
      pieza(() => listarSitios(false), true),
      pieza(() => listarSitios(true), true),
    ]);
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
    return true;
  }

  if (ruta === '/api/vps/detalle') {
    const sitio = url.searchParams.get('sitio') ?? '';
    if (!NOMBRE_OK.test(sitio)) {
      json(res, 400, { error: 'nombre-invalido', sitio });
      return true;
    }
    if (nombresConocidos && !nombresConocidos.includes(sitio)) {
      json(res, 404, { error: 'sitio-desconocido', sitio });
      return true;
    }
    if (!rutaBinario()) {
      json(res, 503, { error: 'sin-binario' });
      return true;
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
    return true;
  }

  if (ruta === '/api/vps/recursos') {
    if (!rutaBinario()) {
      json(res, 503, { error: 'sin-binario' });
      return true;
    }
    const texto = await pieza(() => auditoria(), true);
    /* Formato real del audit (verificado 2026-09-29): lineas
     * `Load:`, `CPU: sampleN busy=X%`, `Memoria: used=A free=B total=C`,
     * `Disco: ... use=N%` y `nombre=Up <tiempo> [(healthy)]` por contenedor.
     * Si el formato cambia, el resumen cae a no-disponible y queda el texto. */
    let resumen: VpsPieza = { ok: false, datos: null, error: 'sin-metricas' };
    if (texto.ok) {
      const crudo = String(texto.datos);
      const metricas: { metrica: string; pct: number }[] = [];
      const busys = [...crudo.matchAll(/busy=([0-9.]+)%/g)].map((m) => Number(m[1]));
      if (busys.length > 0) {
        metricas.push({
          metrica: 'cpu',
          pct: Math.round((busys.reduce((a, b) => a + b, 0) / busys.length) * 10) / 10,
        });
      }
      const mem = /Memoria:\s*used=(\d+)MB\s*free=\d+MB\s*total=(\d+)MB/.exec(crudo);
      if (mem) {
        metricas.push({
          metrica: 'memoria',
          pct: Math.round((Number(mem[1]) / Number(mem[2])) * 1000) / 10,
        });
      }
      const disco = /Disco:.*use=(\d+)%/.exec(crudo);
      if (disco) metricas.push({ metrica: 'disco', pct: Number(disco[1]) });
      const carga = /Load:\s*([0-9.]+ [0-9.]+ [0-9.]+)/.exec(crudo);
      const contenedores: { nombre: string; actividad: string; saludable: boolean }[] = [];
      for (const m of crudo.matchAll(/^(\S+)=Up\s+([^(]+?)(\(healthy\))?\s*$/gm)) {
        contenedores.push({
          nombre: m[1],
          actividad: m[2].trim(),
          saludable: !!m[3],
        });
      }
      if (metricas.length > 0 || contenedores.length > 0) {
        resumen = {
          ok: true,
          datos: {
            metricas,
            carga: carga ? carga[1] : null,
            contenedores: {
              total: contenedores.length,
              sanos: contenedores.filter((c) => c.saludable).length,
              noSanos: contenedores.filter((c) => !c.saludable).map((c) => c.nombre),
            },
          },
          error: null,
        };
      }
    }
    json(res, 200, { piezas: { resumen, texto } });
    return true;
  }

  return false;
}
