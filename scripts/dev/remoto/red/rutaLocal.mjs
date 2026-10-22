/* Ruta local de una entrada del proyecto. Módulo hoja: sin imports de ficha ni de entorno,
 * para que ambos puedan usarlo sin formar un ciclo (ficha ↔ entorno). */

import { isAbsolute, normalize, resolve } from 'node:path';

import { RAIZ_REPO } from '../../doctor.mjs';

export function rutaAbsDe(entrada) {
  return isAbsolute(entrada.ruta) ? normalize(entrada.ruta) : resolve(RAIZ_REPO, entrada.ruta);
}
