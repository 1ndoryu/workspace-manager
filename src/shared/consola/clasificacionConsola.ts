/* Clasificacion pura de problemas del workspace para la consola.
 * [por que] Vive en shared para que la use el cliente (consola) y el servidor
 * (ruta /api/consola/problemas, 07AA-1 F1): una sola clasificacion en ambos
 * lados, sin tuberia paralela. Solo tipos de shared/types.js y shared/dev.js;
 * sin DOM ni Node, para importar desde cualquier entry.
 * Este archivo es solo barrel: las clasificaciones viven en clasificacionConsola/
 * y se reexportan aquí para que los importadores no cambien (19AA-13). */

export type {
  Categoria,
  SeveridadSentinel,
  Entrada,
  SeveridadVuln,
  Problema,
} from './clasificacionConsola/consola-tipos.js';
export { problemasDe } from './clasificacionConsola/consola-proyecto.js';
export { problemasSentinelDe, problemasVulnerabilidadDe } from './clasificacionConsola/consola-analisis.js';
export { problemasDevDe, problemaHuerfanosSinProyecto } from './clasificacionConsola/consola-dev.js';
export { problemasSaludDe, problemaSaludArea, problemasTallerDe } from './clasificacionConsola/consola-salud.js';
export { contarProblemas, categoriasDe, huellaMotivo, marcarHuellas, rutaRelativa } from './clasificacionConsola/consola-util.js';
