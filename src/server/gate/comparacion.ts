/* Comparación de hallazgos del gate contra una línea base (10AA-2 F9.4).
 * [por que] El agente necesita saber qué PROPIOS hallazgos introdujo su cambio,
 * no la lista entera del proyecto (la deuda heredada no es suya). Función pura:
 * el I/O (snapshot en disco, análisis) vive en la ruta y en el CLI. */
import type { HallazgoSentinel } from '../../shared/types.js';

export interface ResultadoComparacion {
  /* Hallazgos actuales que no estaban en la base: los que cuenta el cierre. */
  nuevos: HallazgoSentinel[];
  /* Entradas de la base que ya no aparecen: informativo, no bloquea. */
  resueltos: number;
}

/* Clave sin número de línea. [por que] Editar código desplaza las líneas de
 * un hallazgo viejo: si la línea entrara en la clave, cada edición por encima
 * lo contaría como nuevo. Con fuente+regla+archivo, el mismo problema sigue
 * igualado aunque se mueva. */
export function claveHallazgo(h: HallazgoSentinel): string {
  return `${h.fuente ?? 'sentinel'}|${h.ruleId}|${h.archivo}`;
}

/* Comparación por multiconjunto: si la base tiene 2 hallazgos con la misma
 * clave y ahora hay 3, solo el tercero es nuevo. [por que] Un conjunto simple
 * ocultaría que un mismo fallo se ha duplicado en el mismo archivo. */
export function compararHallazgos(
  base: readonly HallazgoSentinel[],
  actuales: readonly HallazgoSentinel[],
): ResultadoComparacion {
  const pendientes = new Map<string, number>();
  for (const h of base) {
    const k = claveHallazgo(h);
    pendientes.set(k, (pendientes.get(k) ?? 0) + 1);
  }
  const nuevos: HallazgoSentinel[] = [];
  for (const h of actuales) {
    const k = claveHallazgo(h);
    const quedan = pendientes.get(k) ?? 0;
    if (quedan > 0) pendientes.set(k, quedan - 1);
    else nuevos.push(h);
  }
  let resueltos = 0;
  for (const cuenta of pendientes.values()) resueltos += cuenta;
  return { nuevos, resueltos };
}
