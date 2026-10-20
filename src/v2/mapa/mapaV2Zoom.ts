/* Límites y paso del zoom del mapa v2. [por que] Constantes y una función pura: el hook
 * las usa para acercar, alejar, la pinza y la rueda, y el estado guardado se acota con
 * las mismas reglas al leerlo. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_PASO = 0.5;

/* Acota el zoom al rango permitido: nunca por debajo de ZOOM_MIN ni por encima de ZOOM_MAX. */
export function limitarZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}
