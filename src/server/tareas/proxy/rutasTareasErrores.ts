/* Traduccion de errores del nucleo TASKS a HTTP honesto (nunca 200 con error).
 * [por que] Sacado de rutasTareas.ts: el mapeo es una tabla pura, sin estado ni red, y las
 * rutas solo deben decidir qué pedir, no cómo se nombra cada fallo. */
import type {ServerResponse} from 'node:http';
import {json} from '../../http.js';
import type {ErrorKanban} from '../nucleo/tipos.js';

const CODIGOS_KANBAN = [
  'no-autenticado',
  'no-encontrado',
  'validacion',
  'lote-duplicado',
  'cuota',
  'red',
  'servidor',
];

export function esErrorKanban(e: unknown): e is ErrorKanban {
  if (typeof e !== 'object' || e === null) return false;
  const c = (e as {codigo?: unknown}).codigo;
  return typeof c === 'string' && CODIGOS_KANBAN.includes(c);
}

/* Traduce el error del nucleo a HTTP honesto (nunca 200 con error). */
export function responderKanban(res: ServerResponse, e: unknown, noEncontrado = 'proyecto-no-encontrado'): void {
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
