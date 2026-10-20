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
import {sincronizarColumnas, type EntradaWm} from './sincronizacion/sincronizar-proyectos.js';
import {sincronizarTareasRoadmap, type ProyectoWm} from './sincronizacion/sincronizar-tareas.js';
import {escribirRoadmaps} from './escritura/escribir-roadmaps.js';
import {validarParche} from './tarea-unitaria.js';
import {estadoTaller} from '../taller/estado.js';
import {revisarTuneles} from '../taller/tuneles.js';

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
  /* Repos WM en orden de snapshot, ya sin ignorados (produccion: lo sirve
   * index.ts desde `snapshotArea(false)`; tests: lista fija). Puede ser async. */
  leerWm?: () => EntradaWm[] | Promise<EntradaWm[]>;
  /* Proyectos con su carpeta, para la sincronizacion del roadmap (20AA-10 F2):
   * la clave empareja con la columna de TASK y la ruta da el roadmap.md. */
  leerProyectos?: () => ProyectoWm[] | Promise<ProyectoWm[]>;
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
  const leerWm = deps.leerWm ?? (() => []);
  const leerProyectos = deps.leerProyectos ?? (() => []);

  /* [por que] Un `red` suele ser el túnel caído, y es justo el fallo que ve la
   * usuaria en la tab: se pide al supervisor que revise (solo repara proyectos
   * que la 89 tiene en marcha) sin bloquear esta respuesta. El estado del taller
   * llega de caché cuando el panel lo ha pedido hace poco. */
  function revisarTunelesDelTaller(): void {
    void estadoTaller()
      .then(({entrada}) => revisarTuneles(entrada.t89?.tmux ?? []))
      .catch(() => undefined);
  }

  function responder(res: ServerResponse, e: unknown, noEncontrado?: string): void {
    if (esErrorKanban(e) && e.codigo === 'red') revisarTunelesDelTaller();
    responderKanban(res, e, noEncontrado);
  }

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
    /* Columnas fijas sincronizadas (08AA-6): empareja cada repo WM con su
     * proyecto TASKS por `wmClave` y crea en TASKS los que falten (sync
     * puro: nunca borra; ignorado = sin columna). Responde las columnas en
     * orden de snapshot: el front las pinta directas, sin emparejar. */
    if (ruta === '/api/tareas/proyectos' && req.method === 'GET') {
      try {
        const proyectos = await sincronizarColumnas({
          wm: await leerWm(),
          task: await puente.proyectos(),
          crear: (legacyId, entrada) => puente.crearProyecto(legacyId, entrada.nombre, entrada.clave),
        });
        json(res, 200, {proyectos});
      } catch (e) {
        responder(res, e);
      }
      return true;
    }
    /* Sincronizacion roadmap -> TASK (20AA-10 F2). En seco (`?seco=1`) cuenta
     * lo que haria sin escribir nada: es la primera pasada, para mirarla antes
     * de tocar TASK. No borra nada y no escribe ningun archivo. */
    if (ruta === '/api/tareas/sincronizar' && req.method === 'POST') {
      try {
        const informe = await sincronizarTareasRoadmap(
          { proyectos: leerProyectos, puente },
          { seco: url.searchParams.get('seco') === '1' },
        );
        json(res, 200, informe);
      } catch (e) {
        responder(res, e);
      }
      return true;
    }
    /* Escritura TASK -> roadmap (20AA-10 F3). Antes de tocar un archivo ajeno
     * hace copia verificada y anota el cambio; en seco (`?seco=1`) solo cuenta.
     * Los conflictos (no se sabe quien cambio despues) vuelven en `avisos` y no
     * se escribe nada de esa tarea. */
    if (ruta === '/api/tareas/escribir-roadmap' && req.method === 'POST') {
      try {
        const informe = await escribirRoadmaps(
          { proyectos: leerProyectos, puente },
          { seco: url.searchParams.get('seco') === '1' },
        );
        json(res, 200, informe);
      } catch (e) {
        responder(res, e);
      }
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
        responder(res, e);
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
        responder(res, e);
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
          responder(res, e, 'tarea-no-encontrada');
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
