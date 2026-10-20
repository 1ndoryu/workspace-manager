/* Rutas del CLI provisionado de quality:setup. Puras: solo calculan rutas, no tocan disco. */

import path from 'node:path';
import { NOMBRE_QUALITY_TOOLS } from '../shared/rutas.mjs';

/* Ruta del CLI provisionado declarado por el manifiesto (misma resolución que
 * el lock-generator: `provisionPath` + `cli`). Null si no se declara. */
export function rutaCli(proyecto, config) {
  if (typeof config.cli !== 'string' || !config.cli) return null;
  return path.join(path.resolve(proyecto, config.provisionPath ?? NOMBRE_QUALITY_TOOLS), config.cli);
}
