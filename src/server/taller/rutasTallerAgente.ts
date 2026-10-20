/* Rutas del pulse del taller (/api/taller/agente y /api/taller/pieza, 20AA-16).
 * [por que] El frente no habla con pulse: el Bearer vive en el servidor (agenteTaller.ts) y aquí
 * solo se enruta, se valida y se responde. Mismo patrón que las rutas de vps: la lista de proyectos
 * sale del registro (fila aunque el proyecto esté parado) y pulse aporta lo vivo. Devuelve true si
 * atendió. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import { leerRegistroOpcional } from '../registro.js';
import { redactar } from '../vps/puente.js';
import { agenteTaller } from './agenteTaller.js';
import { proyectosDelTaller } from './proyectosTaller.js';

/* Las 7 piezas de pulse en modo procesos: allowlist, nunca el nombre crudo del cliente. */
const PIEZAS = new Set(['salud', 'stats', 'inspeccion', 'eventos', 'bd', 'diagnostico', 'logs']);
const MAX_LINEAS = 500;

/* Nombre de proyecto: el mismo alfabeto que `es_sitio_valido` de pulse (ids del taller con
 * espacios), más el arranque en alfanumérico. Fail-closed. */
const SITIO_OK = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/;

/* Claves que jamás salen: los logs del taller arrastran el entorno del proyecto. */
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

export async function manejarRutasTallerAgente(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  if (ruta !== '/api/taller/agente' && ruta !== '/api/taller/pieza') return false;
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  const agente = agenteTaller();
  if (!agente) {
    json(res, 200, { disponible: false, snapshot: null, error: 'sin-configurar' });
    return true;
  }
  /* La lista de proyectos del registro es también la allowlist: pulse solo atiende a los que
   * conoce el taller, así que un nombre inventado no llega ni a salir del portátil. */
  const proyectos = proyectosDelTaller(leerRegistroOpcional());

  if (ruta === '/api/taller/agente') {
    const r = await agente.snapshot();
    json(res, 200, { ...r, proyectos });
    return true;
  }

  const sitio = url.searchParams.get('sitio') ?? '';
  if (!SITIO_OK.test(sitio) || !proyectos.some((p) => p.id === sitio)) {
    json(res, 404, { error: 'proyecto-desconocido', sitio });
    return true;
  }
  const pieza = url.searchParams.get('pieza') ?? '';
  if (!PIEZAS.has(pieza)) {
    json(res, 400, { error: 'pieza-invalida', pieza, validas: [...PIEZAS] });
    return true;
  }
  const lineas = Number.parseInt(url.searchParams.get('lineas') ?? '200', 10);
  const n = Number.isFinite(lineas) ? Math.min(Math.max(lineas, 1), MAX_LINEAS) : 200;
  try {
    const crudo = (await agente.pieza(sitio, pieza, n)) as { ok?: unknown; datos?: unknown; error?: unknown };
    const resultado = {
      ok: crudo?.ok === true,
      datos: crudo?.ok === true ? sanearJson(crudo.datos) : null,
      error: typeof crudo?.error === 'string' ? crudo.error.slice(0, 200) : crudo?.ok === true ? null : 'pulse-pieza',
    };
    json(res, 200, { sitio, pieza, resultado });
  } catch (err) {
    json(res, 200, {
      sitio,
      pieza,
      resultado: { ok: false, datos: null, error: String(err).slice(0, 200) },
    });
  }
  return true;
}
