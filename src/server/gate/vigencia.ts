/* Separa lo guardado que sigue valiendo de lo que ya no describe el repo.
 * [por que] Un dato solo es vigente si su clave de frescura coincide con la actual.
 * Antes, las rutas de consola y de gate devolvian todo lo guardado sin mirar la clave:
 * tras un commit el tablero seguia mostrando el analisis del HEAD anterior hasta que
 * alguien forzaba. Funcion pura (sin disco ni spawn): se prueba aislada. */
import type { Proyecto } from '../../shared/types.js';

export interface Vigencia<T> {
  vigentes: T[];
  /* Proyectos sin dato vigente: se muestran como «sin analizar», no con un dato viejo. */
  desactualizados: Proyecto[];
}

export function separarVigencia<T>(
  proyectos: Proyecto[],
  frescoDe: (p: Proyecto) => string,
  leerFresco: (clave: string, fresco: string) => T | null,
): Vigencia<T> {
  const vigentes: T[] = [];
  const desactualizados: Proyecto[] = [];
  for (const p of proyectos) {
    const dato = leerFresco(p.clave, frescoDe(p));
    if (dato) vigentes.push(dato);
    else desactualizados.push(p);
  }
  return { vigentes, desactualizados };
}
