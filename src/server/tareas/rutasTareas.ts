/* Proxy de la tab tareas (07AA-5 F2).
 * [por que] D1: el front jamas toca TASKS ni las credenciales; estas rutas
 * validan la entrada (legacy_id entero, lote con el tope del nucleo) y
 * delegan en el puente. Errores honestos: validacion 422, no-encontrado
 * 404, cuota 429 (+Retry-After), red 503 con el motivo del puente. Puente
 * y lector de body inyectables: los tests no tocan red. */
import type {IncomingMessage, ServerResponse} from 'node:http';
import {json, leerBody} from '../http.js';
import type {ErrorKanban} from './nucleo/tipos.js';
import {esIdValido, validarLote} from './nucleo/validaciones.js';
import {crearPuenteTareas, puenteTareas, type PuenteTareas} from './puente-tareas.js';
import {validarParche} from './tarea-unitaria.js';

const CODIGOS_KANBAN = [
  'no-autenticado',
  'no-encontrado',
  'validacion',
  'lote-duplicado',
  'cuota',
  'red',
  'servidor',
];

export interface DepsRutasTareas {
  puente?: PuenteTareas;
  leerCuerpo?: (req: IncomingMessage) => Promise<unknown>;
}

function esErrorKanban(e: unknown): e is ErrorKanban {
  if (typeof e !== 'object' || e === null) return false;
  const c = (e as {codigo?: unknown}).codigo;
  return typeof c === 'string' && CODIGOS_KANBAN.includes(c);
}

/* Traduce el error del nucleo a HTTP honesto (nunca 200 con error). */
function responderKanban(res: ServerResponse, e: unknown, noEncontrado = 'proyecto-no-encontrado'): void {
  if (!esErrorKanban(e)) {
    json(res, 500, {error: 'error-interno-tareas'});
    return;
  }
  switch (e.codigo) {
    case 'validacion':
    case 'lote-duplicado':
      json(res, 422, {error: 'lote-invalido', detalle: e.mensaje});
      return;
    case 'no-encontrado':
      json(res, 404, {error: noEncontrado, detalle: e.mensaje});
      return;
    case 'cuota': {
      const segs = Math.max(1, Math.ceil((e.reintentarEnMs ?? 1000) / 1000));
      res.setHeader('Retry-After', String(segs));
      json(res, 429, {error: 'cuota-tasks', detalle: e.mensaje, reintentarEnMs: e.reintentarEnMs ?? null});
      return;
    }
    case 'red':
      json(res, 503, {error: 'tareas-no-disponibles', motivo: e.mensaje});
      return;
    case 'servidor':
      json(res, 502, {error: 'tareas-error', detalle: e.mensaje});
      return;
    case 'no-autenticado':
      json(res, 503, {error: 'tareas-sin-sesion', detalle: e.mensaje});
      return;
  }
}

export function crearManejadorTareas(deps: DepsRutasTareas = {}) {
  const puente = deps.puente ?? puenteTareas;
  const leerCuerpo = deps.leerCuerpo ?? leerBody;

  return async function manejarRutasTareas(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ruta: string,
  ): Promise<boolean> {
    if (ruta === '/api/tareas/estado' && req.method === 'GET') {
      json(res, 200, puente.estado());
      return true;
    }
    if (ruta === '/api/tareas/proyecto' && req.method === 'GET') {
      const crudo = url.searchParams.get('legacy_id') ?? '';
      const legacyId = Number(crudo);
      if (!esIdValido(legacyId)) {
        json(res, 400, {error: 'legacy_id-invalido', legacy_id: crudo});
        return true;
      }
      try {
        const tareas = await puente.listar(legacyId);
        json(res, 200, {tareas});
      } catch (e) {
        responderKanban(res, e);
      }
      return true;
    }
    if (ruta === '/api/tareas/reordenar' && req.method === 'POST') {      let cuerpo: unknown;
      try {
        cuerpo = await leerCuerpo(req);
      } catch {
        json(res, 400, {error: 'body-invalido'});
        return true;
      }
      const movs =
        typeof cuerpo === 'object' && cuerpo !== null
          ? (cuerpo as {movimientos?: unknown}).movimientos
          : undefined;
      const validado = validarLote(movs);
      if (!validado.ok) {
        json(res, 422, {error: 'lote-invalido', detalle: validado.errores});
        return true;
      }
      try {
        const actualizadas = await puente.reordenar(validado.lote);
        json(res, 200, {actualizadas});
      } catch (e) {
        responderKanban(res, e);
      }
      return true;
    }
    /* Edición inline de una tarea (07AA-15): PUT actualiza (upsert F1),
     * DELETE elimina (204 como F1). El id viaja en la ruta, el parche en el
     * body; el puente firma con la sesión D1. */
    if (ruta.startsWith('/api/tareas/tarea/') && (req.method === 'PUT' || req.method === 'DELETE')) {
      const legacyId = Number(ruta.slice('/api/tareas/tarea/'.length));
      if (!esIdValido(legacyId)) {
        json(res, 400, {error: 'legacy_id-invalido'});
        return true;
      }
      if (req.method === 'DELETE') {
        try {
          await puente.eliminar(legacyId);
          res.writeHead(204);
          res.end();
        } catch (e) {
          responderKanban(res, e, 'tarea-no-encontrada');
        }
        return true;
      }
      let cuerpo: unknown;
      try {
        cuerpo = await leerCuerpo(req);
      } catch {
        json(res, 400, {error: 'body-invalido'});
        return true;
      }
      const validado = validarParche(cuerpo);
      if (!validado.ok) {
        json(res, 422, {error: 'parche-invalido', detalle: validado.errores});
        return true;
      }
      try {
        const tarea = await puente.actualizar(legacyId, validado.valor);
        json(res, 200, {tarea});
      } catch (e) {
        responderKanban(res, e, 'tarea-no-encontrada');
      }
      return true;
    }
    return false;
  };
}

/* Manejador de produccion (puente con env del proceso). */
export const manejarRutasTareas = crearManejadorTareas();

/* Fábrica exportada para tests que quieran puente fresco con env propio. */
export {crearPuenteTareas};
