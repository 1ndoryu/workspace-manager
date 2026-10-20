/* Barril del analisis del roadmap: el parseo puro vive en roadmapAnalisis.ts y el resumen con
 * E/S en roadmapResumen.ts. Aqui se reexporta todo para que los importadores no cambien. */
export {
  SECCIONES_ROADMAP,
  TOPE_LINEAS_ROADMAP,
  TOPE_TAREAS,
  CLAVES_PROPIEDAD,
  analizarRoadmap,
} from './roadmapAnalisis.js';
export type {
  ClavePropiedad,
  PropiedadesTarea,
  SubtareaRoadmap,
  TareaRoadmap,
  ProblemaRoadmap,
  AnalisisRoadmap,
} from './roadmapAnalisis.js';
export { resumenRoadmap } from './roadmapResumen.js';
