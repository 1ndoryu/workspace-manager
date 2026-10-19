/* Almacén de vulnerabilidades por proyecto: memoria + `data/cache/vulnerabilidades.json`.
 * [por qué está aparte] `vulnerabilidades.ts` sabe auditar (lanzar cargo-audit/npm
 * audit y agregar); esto solo sabe guardar y servir. La mecánica (carga, persistencia,
 * poda) vive en `almacenPersistido.ts`, compartida con el almacén de análisis. */
import { join } from 'node:path';
import { RAIZ_AREA } from '../../plataforma/rutas.js';
import type { AnalisisVulnerabilidades } from '../../../shared/types.js';
import { crearAlmacenPersistido } from '../almacenPersistido.js';

/* [por que] Solo entra en la caché una MEDICIÓN: `conHallazgos` u `ok`. Ni
 * `error` ni `noAuditable`.
 *
 * `error` es transitorio (timeout, la 89 ocupada) y guardarlo servía «error»
 * hasta el siguiente forzado.
 *
 * `noAuditable` lo parecía estable y no lo es: el único caso estructural —sin
 * lockfile— sale antes de llegar aquí (`vulnerabilidades.ts`, el `return` de
 * `locks.length === 0`), así que **todo `noAuditable` que llega a guardarse es
 * un fallo de medición**: `cargo-audit`/`pnpm` ausente, o el audit remoto que no
 * respondió. Congelarlo dejaba el proyecto en «0 problemas» hasta el día
 * siguiente —el día va en la clave de frescura—, que es justo el silencio que
 * este almacén existe para evitar. Se prefiere volver a preguntar.
 *
 * Función pura: se testea sin lanzar ninguna herramienta. */
export function esCacheable(dato: AnalisisVulnerabilidades): boolean {
  return dato.estado === 'conHallazgos' || dato.estado === 'ok';
}

/* [por que] la persistencia vive dentro del area del manager (data/cache/),
 * NO en el runtime de las herramientas ni en ningun proyecto real. */
const almacen = crearAlmacenPersistido<AnalisisVulnerabilidades>(
  join(RAIZ_AREA, 'data', 'cache', 'vulnerabilidades.json'),
  esCacheable,
);

export const {
  frescos: vulnerabilidadesFrescas,
  guardar: guardarVulnerabilidades,
  podar: podarVulnerabilidades,
  leer: leerVulnerabilidades,
} = almacen;
