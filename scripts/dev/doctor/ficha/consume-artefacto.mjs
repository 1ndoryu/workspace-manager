/* Validacion de `consumeArtefacto` (20AA-7), el campo que declara que una
 * entrada empotra el artefacto de compilacion de OTRO proyecto (hoy
 * MN-Escritorio mete el `frontend/dist` de MN-Inmobiliaria dentro del .exe).
 *
 * [por que] Vive aparte de `validacion.mjs` porque ese archivo esta en el limite
 * de 300 lineas efectivas del gate: un sub-esquema con sus cuatro claves y su
 * propia regla de rutas no cabe como un bloque mas.
 *
 * Aqui solo se valida la FORMA. Que `proyecto` corresponda a una ficha real lo
 * comprueba `detectarArtefactos` (`doctor/sistema/artefactos.mjs`), que si ve el
 * registro entero; esto valida una entrada por proyecto. */

import { isAbsolute, normalize, sep } from 'node:path';

const CLAVES = ['proyecto', 'ruta', 'producto', 'instalado'];

/* Una ruta relativa que no se escapa del proyecto. [por que] `ruta` y `producto`
 * se resuelven contra el `dirRemotoBase` y el target de la 89, asi que un `..` o
 * una ruta absoluta apuntaria fuera de donde se cree. */
function relativaDentro(v) {
  if (typeof v !== 'string' || v.length === 0 || isAbsolute(v)) return false;
  const norm = normalize(v);
  return norm !== '..' && !norm.startsWith('..' + sep);
}

/* Valida el campo de la entrada `e`. Devuelve true si es valido; si no, deja el
 * motivo en `mal` (el acumulador de `validarEntrada`) y devuelve false. */
export function validarConsumeArtefacto(e, mal) {
  const a = e.consumeArtefacto;
  if (typeof a !== 'object' || a === null || Array.isArray(a)) {
    mal(`registro: '${e.id}' consumeArtefacto no es objeto`);
    return false;
  }
  for (const k of Object.keys(a)) {
    if (!CLAVES.includes(k)) {
      mal(`registro: '${e.id}' consumeArtefacto con clave desconocida '${k}'`);
      return false;
    }
  }
  if (typeof a.proyecto !== 'string' || a.proyecto.length === 0 || a.proyecto === e.id) {
    mal(`registro: '${e.id}' consumeArtefacto.proyecto debe ser el id de otro proyecto`);
    return false;
  }
  for (const k of ['ruta', 'producto']) {
    if (!relativaDentro(a[k])) {
      mal(`registro: '${e.id}' consumeArtefacto.${k} debe ser una ruta relativa dentro del proyecto`);
      return false;
    }
  }
  if ('instalado' in a && (typeof a.instalado !== 'string' || !isAbsolute(a.instalado))) {
    mal(`registro: '${e.id}' consumeArtefacto.instalado debe ser ruta absoluta`);
    return false;
  }
  return true;
}
