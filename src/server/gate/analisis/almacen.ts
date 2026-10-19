/* Almacén del análisis por proyecto: memoria + `data/cache/analisis.json`.
 * Solo guarda y sirve; lanzar el CLI de Sentinel está en `analizador.ts`. La mecánica
 * (carga, persistencia, poda) es la misma que la del almacén de vulnerabilidades y
 * vive en `almacenPersistido.ts`. */
import { join } from 'node:path';
import { RAIZ_AREA } from '../../plataforma/rutas.js';
import type { AnalisisSentinel } from '../../../shared/types.js';
import { crearAlmacenPersistido } from '../almacenPersistido.js';

/* [08AA-26] Solo un analisis valido entra en la cache. Un error es transitorio
 * (p. ej. timeout o runtime ocupado): cachearlo servia "error" en el tablero hasta
 * el siguiente forzado. Si ya habia un analisis valido, se conserva.
 * [por que] Funcion pura: se testea sin lanzar el CLI de Sentinel. */
export function esCacheable(dato: AnalisisSentinel): boolean {
  return dato.estado !== 'error';
}

/* [por que] la persistencia vive dentro del area del manager (data/cache/),
 * NO en el runtime de sentinel (solo lectura) ni en ningun proyecto real. */
const almacen = crearAlmacenPersistido<AnalisisSentinel>(
  join(RAIZ_AREA, 'data', 'cache', 'analisis.json'),
  esCacheable,
);

export const { frescos: analisisFresco, guardar: guardarAnalisis, podar: podarAnalisis, leer: leerAnalisis } = almacen;
