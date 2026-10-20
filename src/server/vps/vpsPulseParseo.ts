/* Contrato de pulse (F0) en forma pura: validación de filas, adaptación al modelo de la
 * app y enriquecimiento con sitios. Sin E/S ni red; lo usa el cliente de `agente.ts`. */
import type { VpsAgenteContenedor } from '../../shared/types.js';
import { esNumero } from '../../shared/guardas.js';

/* Filas tal cual las sirve pulse (ver `glory-pulse/schema/ejemplo.json` y
 * `snapshot.schema.json`, contrato F0 canónico): filas ANIDADAS
 * (`id12`, `estado:{...}`, `recursos:{...}` en bytes). [309A-fix 2026-09-30:
 * F2 validaba una forma plana que el binario nunca produjo → `agente-contrato`
 * contra prod; a partir de ahora manda F0. Sin `imagen`/`sitioUuid`/`dominio`
 * en el origen: se sirven ''/null y la UI los tolera. */
export interface FilaPulse {
  id12: string;
  nombre: string;
  estado: { estado: string; salud?: unknown; reinicios?: unknown; desde?: unknown };
  recursos: {
    cpuPct: number;
    memUsada: number;
    memLimite: number;
    blkRo: number;
    blkWo: number;
    netRx: number;
    netTx: number;
  };
  puertos?: unknown;
  sitioUuid?: string | null;
  dominio?: string | null;
  imagen?: string | null;
}

export interface SnapshotPulse {
  schema: number;
  hostId: string;
  ts: number;
  contenedores: FilaPulse[];
  discoHost?: unknown;
  truncado: boolean;
  totalContenedores: number;
}

/* [309A-2] Detalle por sitio tal cual lo sirve pulse
 * (`glory-pulse/schema/ejemplo-detalle.json`): mismas filas, sin
 * `truncado` (un sitio cabe) y con `sitio` eco. */
export interface DetallePulse {
  schema: number;
  hostId: string;
  ts: number;
  sitio: string;
  contenedores: FilaPulse[];
  totalContenedores: number;
}

function esFila(v: unknown): v is FilaPulse {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  if (typeof f['id12'] !== 'string' || typeof f['nombre'] !== 'string') return false;
  const e = f['estado'];
  if (!e || typeof e !== 'object' || typeof (e as Record<string, unknown>)['estado'] !== 'string') return false;
  const r = f['recursos'];
  if (!r || typeof r !== 'object') return false;
  const rec = r as Record<string, unknown>;
  for (const k of ['cpuPct', 'memUsada', 'memLimite', 'blkRo', 'blkWo', 'netRx', 'netTx']) {
    if (!esNumero(rec[k])) return false;
  }
  for (const k of ['sitioUuid', 'dominio', 'imagen'] as const) {
    const val = f[k];
    if (val !== undefined && val !== null && typeof val !== 'string') return false;
  }
  return true;
}

/* [0110A-1] IO del host: ausente en pulse <0.3.0 (sigue válido, se
 * sirve null); presente = el par entero de números finitos, si no
 * `agente-contrato`. Nunca se adapta a medias: o el par o null. */
export function esDiscoHost(v: unknown): v is { sectoresLeidos: number; sectoresEscritos: number } {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return esNumero(d['sectoresLeidos']) && esNumero(d['sectoresEscritos']);
}

/* Contrato estricto: schema distinto de 1 o forma inesperada se rechaza
 * (nunca se adapta a medias: el frontend cae al legacy). */
export function esSnapshot(v: unknown): v is SnapshotPulse {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    s['schema'] === 1 &&
    typeof s['hostId'] === 'string' &&
    esNumero(s['ts']) &&
    Array.isArray(s['contenedores']) &&
    (s['contenedores'] as unknown[]).every(esFila) &&
    typeof s['truncado'] === 'boolean' &&
    esNumero(s['totalContenedores'])
  );
}

/* [309A-2] Contrato del detalle: mismas filas, `sitio` eco obligatorio. */
export function esDetalle(v: unknown): v is DetallePulse {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    s['schema'] === 1 &&
    typeof s['hostId'] === 'string' &&
    esNumero(s['ts']) &&
    typeof s['sitio'] === 'string' &&
    Array.isArray(s['contenedores']) &&
    (s['contenedores'] as unknown[]).every(esFila) &&
    esNumero(s['totalContenedores'])
  );
}

const MIB = 1024 * 1024;

/* Coolify nombra `app-{uuid}` / `postgres-{uuid}` (y `socket-proxy-{uuid}`,
 * `mariadb-{uuid}`, `wordpress-{uuid}` en stacks WP): el uuid enlaza con el
 * sitio de settings sin tocar Rust (pulse aun manda sitioUuid null). */
export function extraerUuidContenedor(nombre: string): string | null {
  const m = /^(?:app|postgres|socket-proxy|mariadb|wordpress)-([A-Za-z0-9]+)$/.exec(nombre);
  return m ? m[1] : null;
}

export interface InfoSitio {
  nombre: string;
  dominio: string;
}

/* Enriquecimiento puro: resuelve `sitio` + `dominio` desde el mapa
 * uuid→sitio del backend. Sin entrada, fila intacta (sitio null). */
export function enriquecerConSitios(
  contenedores: VpsAgenteContenedor[],
  mapa: Map<string, InfoSitio>,
): VpsAgenteContenedor[] {
  return contenedores.map((c) => {
    const uuid = extraerUuidContenedor(c.nombre);
    const info = uuid ? mapa.get(uuid) : undefined;
    if (!info) return c;
    return { ...c, sitio: info.nombre, dominio: c.dominio ?? info.dominio };
  });
}

export function adaptar(f: FilaPulse): VpsAgenteContenedor {
  const limite = f.recursos.memLimite > 0 ? f.recursos.memLimite / MIB : null;
  return {
    id: f.id12,
    nombre: f.nombre,
    estado: f.estado.estado,
    imagen: typeof f.imagen === 'string' ? f.imagen : '',
    cpuPct: f.recursos.cpuPct,
    memMiB: f.recursos.memUsada / MIB,
    memLimiteMiB: limite,
    redRxBytes: f.recursos.netRx,
    redTxBytes: f.recursos.netTx,
    blkReadBytes: f.recursos.blkRo,
    blkWriteBytes: f.recursos.blkWo,
    sitioUuid: f.sitioUuid ?? null,
    dominio: f.dominio ?? null,
    sitio: null,
  };
}
