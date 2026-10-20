/* Rutas del CLI provisionado de quality:setup. Puras: solo calculan rutas, no tocan disco. */

import path from 'node:path';

/* Ruta del CLI provisionado declarado por el manifiesto (misma resolución que
 * el lock-generator: `provisionPath` + `cli`). Null si no se declara. */
export function rutaCli(proyecto, config) {
  if (typeof config.cli !== 'string' || !config.cli) return null;
  return path.join(path.resolve(proyecto, config.provisionPath ?? '.quality-tools'), config.cli);
}
