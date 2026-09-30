/* Cliente del agente glory-pulse (299A-12 F2).
 * [por que] Una sola conexión HTTP contra la VPS sustituye las 7 piezas
 * legacy en serie cuando el agente está desplegado; el legacy sigue como
 * fallback (el frontend decide por `disponible`). El Bearer vive solo aquí:
 * jamás se registra ni se devuelve (los errores son códigos, nunca texto
 * del origen). Breaker: 3 fallos → abierto con sonda cada 60 s. Caché de
 * 5 s para coalescer el poll del frontend. */
import type {
  VpsAgenteContenedor,
  VpsAgenteRespuesta,
  VpsAgenteSnapshot,
} from '../../shared/types.js';

export interface OpcionesAgente {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fallosParaAbrir?: number;
  sondeoMs?: number;
  cacheMs?: number;
  fetchImpl?: typeof fetch;
  ahora?: () => number;
}

/* Filas tal cual las sirve pulse (ver `glory-pulse/schema/ejemplo.json` y
 * `snapshot.schema.json`, contrato F0 canónico): filas ANIDADAS
 * (`id12`, `estado:{...}`, `recursos:{...}` en bytes). [309A-fix 2026-09-30:
 * F2 validaba una forma plana que el binario nunca produjo → `agente-contrato`
 * contra prod; a partir de ahora manda F0. Sin `imagen`/`sitioUuid`/`dominio`
 * en el origen: se sirven ''/null y la UI los tolera. */
interface FilaPulse {
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
}

interface SnapshotPulse {
  schema: number;
  hostId: string;
  ts: number;
  contenedores: FilaPulse[];
  truncado: boolean;
  totalContenedores: number;
}

function esNumero(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
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
  for (const k of ['sitioUuid', 'dominio'] as const) {
    const val = f[k];
    if (val !== undefined && val !== null && typeof val !== 'string') return false;
  }
  return true;
}

/* Contrato estricto: schema distinto de 1 o forma inesperada se rechaza
 * (nunca se adapta a medias: el frontend cae al legacy). */
function esSnapshot(v: unknown): v is SnapshotPulse {
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

const MIB = 1024 * 1024;

function adaptar(f: FilaPulse): VpsAgenteContenedor {
  const limite = f.recursos.memLimite > 0 ? f.recursos.memLimite / MIB : null;
  return {
    id: f.id12,
    nombre: f.nombre,
    estado: f.estado.estado,
    imagen: '',
    cpuPct: f.recursos.cpuPct,
    memMiB: f.recursos.memUsada / MIB,
    memLimiteMiB: limite,
    redRxBytes: f.recursos.netRx,
    redTxBytes: f.recursos.netTx,
    blkReadBytes: f.recursos.blkRo,
    blkWriteBytes: f.recursos.blkWo,
    sitioUuid: f.sitioUuid ?? null,
    dominio: f.dominio ?? null,
  };
}

export function crearAgente(op: OpcionesAgente): { snapshot: () => Promise<VpsAgenteRespuesta> } {
  const timeoutMs = op.timeoutMs ?? 8000;
  const fallosParaAbrir = op.fallosParaAbrir ?? 3;
  const sondeoMs = op.sondeoMs ?? 60_000;
  const cacheMs = op.cacheMs ?? 5000;
  const fetchImpl = op.fetchImpl ?? globalThis.fetch;
  const ahora = op.ahora ?? Date.now;
  const base = op.baseUrl.replace(/\/+$/, '');

  let fallos = 0;
  let abiertoHasta = 0;
  let cache: { cuando: number; snap: VpsAgenteSnapshot } | null = null;

  async function pedir(): Promise<VpsAgenteSnapshot> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/snapshot`, {
        headers: { authorization: `Bearer ${op.token}` },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`agente-http-${res.status}`);
      const crudo: unknown = await res.json();
      if (!esSnapshot(crudo)) throw new Error('agente-contrato');
      const servidoEn = ahora();
      return {
        schema: 1,
        hostId: crudo.hostId,
        ts: crudo.ts,
        contenedores: crudo.contenedores.map(adaptar),
        truncado: crudo.truncado,
        totalContenedores: crudo.totalContenedores,
        frescura: { fuente: 'agente', edadMs: Math.max(0, servidoEn - crudo.ts) },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('agente-timeout');
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  async function snapshot(): Promise<VpsAgenteRespuesta> {
    const t = ahora();
    if (cache && t - cache.cuando < cacheMs) {
      return { disponible: true, snapshot: cache.snap, error: null };
    }
    if (t < abiertoHasta) {
      return { disponible: false, snapshot: null, error: 'agente-abierto' };
    }
    try {
      const snap = await pedir();
      fallos = 0;
      cache = { cuando: t, snap };
      return { disponible: true, snapshot: snap, error: null };
    } catch (err) {
      fallos += 1;
      if (fallos >= fallosParaAbrir) abiertoHasta = t + sondeoMs;
      const codigo = err instanceof Error ? err.message : 'agente-fallo';
      return { disponible: false, snapshot: null, error: codigo.slice(0, 120) };
    }
  }

  return { snapshot };
}

/* Instancia de producción desde env (PULSE_URL + PULSE_TOKEN>=32). Sin env
 * la ruta responde `sin-configurar` y el frontend usa legacy. Singleton
 * perezoso: el token se lee una vez y nunca se expone. */
let prod: { snapshot: () => Promise<VpsAgenteRespuesta> } | null = null;

export function agenteProd(): { snapshot: () => Promise<VpsAgenteRespuesta> } | null {
  const base = (process.env['PULSE_URL'] ?? '').trim();
  const token = (process.env['PULSE_TOKEN'] ?? '').trim();
  if (!base || token.length < 32) return null;
  if (!prod) prod = crearAgente({ baseUrl: base, token });
  return prod;
}
