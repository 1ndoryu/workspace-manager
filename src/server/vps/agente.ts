/* Cliente del agente glory-pulse (299A-12 F2).
 * [por que] Una sola conexión HTTP contra la VPS sustituye las 7 piezas
 * legacy en serie cuando el agente está desplegado; el legacy sigue como
 * fallback (el frontend decide por `disponible`). El Bearer vive solo aquí:
 * jamás se registra ni se devuelve (los errores son códigos, nunca texto
 * del origen). Breaker: 3 fallos → abierto con sonda cada 60 s. Caché de
 * 5 s para coalescer el poll del frontend. */
import type {
  VpsAgenteDetalle,
  VpsAgenteDetalleRespuesta,
  VpsAgenteRespuesta,
  VpsAgenteSnapshot,
} from '../../shared/types.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptar, esDetalle, esDiscoHost, esSnapshot } from './vpsPulseParseo.js';

export { enriquecerConSitios, extraerUuidContenedor } from './vpsPulseParseo.js';
export type { InfoSitio } from './vpsPulseParseo.js';

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

export function crearAgente(op: OpcionesAgente): {
  snapshot: () => Promise<VpsAgenteRespuesta>;
  detalleSitio: (uuid: string) => Promise<VpsAgenteDetalleRespuesta>;
} {
  const timeoutMs = op.timeoutMs ?? 8000;
  const fallosParaAbrir = op.fallosParaAbrir ?? 3;
  const sondeoMs = op.sondeoMs ?? 60_000;
  const cacheMs = op.cacheMs ?? 5000;
  const fetchImpl = op.fetchImpl ?? globalThis.fetch;
  const ahora = op.ahora ?? Date.now;
  const base = op.baseUrl.replace(/\/+$/, '');

  let fallos = 0;
  let abiertoHasta = 0;
  /* Cuándo se abrió el breaker y cuándo llegó el último dato bueno (20AA-24 F2): sin esto el panel
   * sólo sabía que estaba abierto, no desde cuándo ni qué edad tenía lo último que enseñó. */
  let abiertoEn: number | null = null;
  let ultimoBueno: number | null = null;
  let cache: { cuando: number; snap: VpsAgenteSnapshot } | null = null;
  /* [309A-2] Caché por sitio (el detalle no comparte la del snapshot:
   * mezclarlas serviría el sitio A al pedir el B). Mismo breaker: si el
   * agente cae, el detalle cae con él. */
  const cacheDetalle = new Map<string, { cuando: number; det: VpsAgenteDetalle }>();

  async function pedirConTimeout(ruta: string): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${ruta}`, {
        headers: { authorization: `Bearer ${op.token}` },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`agente-http-${res.status}`);
      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('agente-timeout');
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  function anotarFallo(err: unknown): string {
    fallos += 1;
    if (fallos >= fallosParaAbrir) {
      abiertoHasta = ahora() + sondeoMs;
      /* Sólo la primera vez: si se reabre tras la sonda, la usuaria quiere saber desde cuándo
       * lleva caído, no cuándo se reintentó. */
      abiertoEn ??= ahora();
    }
    const codigo = err instanceof Error ? err.message : 'agente-fallo';
    return codigo.slice(0, 120);
  }

  /* Lo que el panel necesita para no mentir mientras el breaker está abierto. */
  function datosBreaker(): { desdeMs: number; ultimoBuenoMs: number | null } {
    const t = ahora();
    return {
      desdeMs: Math.max(0, t - (abiertoEn ?? t)),
      ultimoBuenoMs: ultimoBueno === null ? null : Math.max(0, t - ultimoBueno),
    };
  }

  async function pedir(): Promise<VpsAgenteSnapshot> {
    const crudo = await pedirConTimeout('/snapshot');
    if (!esSnapshot(crudo)) throw new Error('agente-contrato');
    const dhCrudo: unknown = crudo.discoHost;
    let discoHost: VpsAgenteSnapshot['discoHost'] = null;
    if (dhCrudo !== undefined) {
      if (!esDiscoHost(dhCrudo)) throw new Error('agente-contrato');
      discoHost = {
        sectoresLeidos: dhCrudo.sectoresLeidos,
        sectoresEscritos: dhCrudo.sectoresEscritos,
      };
    }
    const servidoEn = ahora();
    return {
      schema: 1,
      hostId: crudo.hostId,
      ts: crudo.ts,
      contenedores: crudo.contenedores.map(adaptar),
      discoHost,
      truncado: crudo.truncado,
      totalContenedores: crudo.totalContenedores,
      frescura: { fuente: 'agente', edadMs: Math.max(0, servidoEn - crudo.ts) },
    };
  }

  async function snapshot(): Promise<VpsAgenteRespuesta> {
    const t = ahora();
    if (cache && t - cache.cuando < cacheMs) {
      return { disponible: true, snapshot: cache.snap, error: null };
    }
    if (t < abiertoHasta) {
      return { disponible: false, snapshot: null, error: 'agente-abierto', breaker: datosBreaker() };
    }
    try {
      const snap = await pedir();
      fallos = 0;
      abiertoEn = null;
      ultimoBueno = ahora();
      cache = { cuando: t, snap };
      return { disponible: true, snapshot: snap, error: null };
    } catch (err) {
      return { disponible: false, snapshot: null, error: anotarFallo(err) };
    }
  }

  async function detalleSitio(uuid: string): Promise<VpsAgenteDetalleRespuesta> {
    const t = ahora();
    const previo = cacheDetalle.get(uuid);
    if (previo && t - previo.cuando < cacheMs) {
      return { disponible: true, detalle: previo.det, error: null };
    }
    if (t < abiertoHasta) {
      return { disponible: false, detalle: null, error: 'agente-abierto', breaker: datosBreaker() };
    }
    try {
      const crudo = await pedirConTimeout(`/detalle?sitio=${encodeURIComponent(uuid)}`);
      if (!esDetalle(crudo)) throw new Error('agente-contrato');
      const det: VpsAgenteDetalle = {
        schema: 1,
        hostId: crudo.hostId,
        ts: crudo.ts,
        sitio: crudo.sitio,
        contenedores: crudo.contenedores.map(adaptar),
        totalContenedores: crudo.totalContenedores,
      };
      fallos = 0;
      abiertoEn = null;
      ultimoBueno = ahora();
      cacheDetalle.set(uuid, { cuando: t, det });
      return { disponible: true, detalle: det, error: null };
    } catch (err) {
      return { disponible: false, detalle: null, error: anotarFallo(err) };
    }
  }

  return { snapshot, detalleSitio };
}

/* Instancia desde env (PULSE_URL + PULSE_TOKEN>=32) o desde el token local
 * estable que el mando dev guarda en <repo>/logs/.pulse-token (gitignored)
 * al arrancar pulse. Sin PULSE_URL se supone pulse local (127.0.0.1:3000).
 * Sin token (ni env ni fichero) la ruta responde `sin-configurar` y el
 * frontend usa legacy. Singleton perezoso (el null NO se cachea: reintenta
 * cada vez hasta que el token exista) y el token nunca se expone. */
/* Pulse local por defecto (sin PULSE_URL). Con nombre, para no esconder el puerto en la línea. */
const PULSE_LOCAL_POR_DEFECTO = 'http://127.0.0.1:3000';

let prod: {
  snapshot: () => Promise<VpsAgenteRespuesta>;
  detalleSitio: (uuid: string) => Promise<VpsAgenteDetalleRespuesta>;
} | null = null;

function leerTokenLocal(): string {
  try {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    return readFileSync(join(raiz, 'logs', '.pulse-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

/* El entorno llega como parámetro [por que] para probar sin tocar variables reales; el
 * singleton `prod` se fija con la primera llamada (en producción siempre es process.env). */
export function agenteProd(entorno: NodeJS.ProcessEnv = process.env): {
  snapshot: () => Promise<VpsAgenteRespuesta>;
  detalleSitio: (uuid: string) => Promise<VpsAgenteDetalleRespuesta>;
} | null {
  const base = (entorno['PULSE_URL'] ?? '').trim() || PULSE_LOCAL_POR_DEFECTO;
  const token = (entorno['PULSE_TOKEN'] ?? '').trim() || leerTokenLocal();
  if (token.length < 32) return null;
  if (!prod) prod = crearAgente({ baseUrl: base, token });
  return prod;
}
