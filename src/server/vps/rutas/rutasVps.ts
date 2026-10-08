/* Rutas de la tab vps (/api/vps/*): despliegues Coolify en solo lectura.
 * [por que] Mismo patron que rutasRepos.ts: el puente (puente.ts) ejecuta,
 * respuestasVps.ts parsea y aqui solo se enruta/responde. Parseo estricto
 * del texto humano del manager (list/health/audit/logs no tienen --json):
 * lo no reconocido es 'desconocido', nunca un estado inventado. Devuelve
 * true si atendio. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json } from '../../http.js';
import type { VpsAviso, VpsConfig, VpsDetalle, VpsPieza, VpsSitio } from '../../../shared/types.js';
import { agenteProd, enriquecerConSitios, type InfoSitio } from '../agente.js';
import { historialProd } from '../historial.js';
import {
  auditoria,
  dbStatsJson,
  diagnoseJson,
  eventosJson,
  inspectJson,
  listarSitios,
  logs,
  NOMBRE_OK,
  rutaBinario,
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
      const contenedores = enriquecerConSitios(r.snapshot.contenedores, mapaSitios);
      /* [07AA-4] Persiste las sumas por sitio de lo YA servido (cero
       * consultas extra; best-effort, nunca rompe la respuesta). */
      historialProd().anotar(contenedores, r.snapshot.ts);
      json(res, 200, {
        ...r,
        snapshot: { ...r.snapshot, contenedores },
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
    const resumen: VpsPieza = texto.ok ? resumirAuditoria(String(texto.datos)) : {
      ok: false,
      datos: null,
      error: 'sin-metricas',
    };
    json(res, 200, { piezas: { resumen, texto } });
    return true;
  }

  return false;
}
