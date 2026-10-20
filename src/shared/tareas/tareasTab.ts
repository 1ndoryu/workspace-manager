/* Tipos y funciones del proxy /api/tareas/* + puras de la tab kanban (07AA-5 F3).
 * [por que] Partido en tipos (contrato), modelo (puras), id (ids nuevos) y cache (foto local).
 * Este archivo solo reexporta: los importadores siguen usando esta ruta. */
export type {
  ArbolTarea,
  CacheTareasTab,
  ColumnaTab,
  ParcheTareaTab,
  TareaPuente,
  TareaTab,
  TareasEstado,
  TareasMovimientoTab,
  TareasProyectoRespuesta,
  TareasReordenarRespuesta,
} from './tareasTab-tipos.js';
export {
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_URGENCIA,
  FECHAS_TAREA,
  PRIORIDADES_TAREA,
  URGENCIAS_TAREA,
} from './tareasTab-tipos.js';
export {
  arbolDeTareas,
  avisoDeRespuesta,
  baseDeEstado,
  columnasDeRespuesta,
  completadoTarea,
  construirMovimientos,
  dependeDeTarea,
  esColumnaTab,
  esSubtarea,
  esTareaTab,
  etiquetasTarea,
  fechaValida,
  fechasTarea,
  listaATexto,
  listaTecleada,
  padreDeTarea,
  parcheConColumna,
  prioridadTarea,
  tareaDePuente,
  tareasDeRespuesta,
  textoTarea,
  urgenciaTarea,
} from './tareasTab-modelo.js';
export { generarIdTarea } from './tareasTab-id.js';
export { clonarCacheTareas, restaurarCacheTareas } from './tareasTab-cache.js';
