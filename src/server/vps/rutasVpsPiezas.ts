/* Piezas pesadas bajo demanda (/api/vps/pieza, 0110A-3 F3).
 * [por que] El legacy /api/vps/detalle corre 7 piezas SSH en serie
 * (120 s medidos): aqui se pide UNA pieza por llamada, sin cache y con
 * timeout propio, para que el lateral la cargue solo al pedirla y una
 * pieza colgada no tumbe a las demas. Archivo aparte (no en
 * rutasVps.ts) para no chocar con el refactor concurrente de esa ruta:
 * solo reutiliza el puente (puente.ts), nunca sus internos. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import type { VpsPieza } from '../../shared/types.js';
import {
  NOMBRE_OK,
  dbStatsJson,
  diagnoseJson,
  eventosJson,
  inspectJson,
  logs,
  redactar,
  rutaBinario,
  salud,
  statsJson,
} from './puente.js';

/* Timeout propio por pieza (plan F3: 15-20 s): si el SSH se cuelga se
 * responde timeout-pieza y el trabajo de fondo muere solo (el puente
 * mata el proceso a los 90 s; la cola se drena sin bloquear a nadie
 * mas, porque esta llamada ya respondio). */
export const TIMEOUT_PIEZA_MS = 20_000;
const MAX_TEXTO = 4000;
/* Nombres de contenedor para ?objetivo=: mismo alfabeto que el sitio
 * pero mas largo (p. ej. `app-<uuid>` ya roza 30). */
const OBJETIVO_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/* Subconjunto de CLAVE_SECRETA de rutasVps.ts (ese es el canonico: se
 * duplica aqui a proposito para no acoplar este archivo a su
 * refactor). */
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

function recortar(texto: string): string {
  const t = texto.trim();
  return t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO)}\n…(recortado)` : t;
}

type CorrePieza = (sitio: string, objetivo: string | null) => Promise<unknown>;

/* Allowlist de piezas: mismo conjunto que el legacy, una por llamada.
 * `logs` acepta ?objetivo= para un contenedor concreto. */
const CORREDORES: Record<string, { correr: CorrePieza; texto: boolean }> = {
  salud: { correr: (s) => salud(s), texto: true },
  stats: { correr: (s) => statsJson(s), texto: false },
  inspeccion: { correr: (s) => inspectJson(s), texto: false },
  eventos: { correr: (s) => eventosJson(s), texto: false },
  bd: { correr: (s) => dbStatsJson(s), texto: false },
  diagnostico: { correr: (s) => diagnoseJson(s), texto: false },
  logs: { correr: (s, o) => logs(s, 100, o ?? undefined), texto: true },
};

export const PIEZAS_VALIDAS = Object.keys(CORREDORES);

/* Dependencias inyectables para el test (prod = puente real). */
export interface DepsPiezas {
  corredores?: Record<string, { correr: CorrePieza; texto: boolean }>;
  hayBinario?: () => boolean;
  timeoutMs?: number;
}

function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const expira = new Promise<T>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error('timeout-pieza')), ms);
  });
  return Promise.race([promesa, expira]).finally(() => clearTimeout(temporizador));
}

async function correrPieza(
  def: { correr: CorrePieza; texto: boolean },
  sitio: string,
  objetivo: string | null,
  timeoutMs: number,
): Promise<VpsPieza> {
  try {
    const datos = await conTimeout(def.correr(sitio, objetivo), timeoutMs);
    return {
      ok: true,
      datos: def.texto && typeof datos === 'string' ? recortar(datos) : sanearJson(datos),
      error: null,
    };
  } catch (err) {
    return { ok: false, datos: null, error: String(err).slice(0, 200) };
  }
}

export function crearManejadorPiezas(deps: DepsPiezas = {}) {
  const corredores = deps.corredores ?? CORREDORES;
  const hayBinario = deps.hayBinario ?? (() => rutaBinario() !== null);
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_PIEZA_MS;

  return async function manejarRutasVpsPiezas(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ruta: string,
  ): Promise<boolean> {
    if (ruta !== '/api/vps/pieza') return false;
    const sitio = url.searchParams.get('sitio') ?? '';
    if (!NOMBRE_OK.test(sitio)) {
      json(res, 400, { error: 'nombre-invalido', sitio });
      return true;
    }
    const pieza = url.searchParams.get('pieza') ?? '';
    const def = corredores[pieza];
    if (!def) {
      json(res, 400, { error: 'pieza-invalida', pieza, validas: Object.keys(corredores) });
      return true;
    }
    const objetivo = url.searchParams.get('objetivo');
    if (objetivo !== null && !OBJETIVO_OK.test(objetivo)) {
      json(res, 400, { error: 'objetivo-invalido', objetivo });
      return true;
    }
    if (!hayBinario()) {
      json(res, 503, { error: 'sin-binario' });
      return true;
    }
    const resultado = await correrPieza(def, sitio, objetivo, timeoutMs);
    json(res, 200, { sitio, pieza, resultado });
    return true;
  };
}

/* Manejador de produccion (puente real). */
export const manejarRutasVpsPiezas = crearManejadorPiezas();
