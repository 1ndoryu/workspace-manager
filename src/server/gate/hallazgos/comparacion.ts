/* Comparación de hallazgos del gate contra una línea base (10AA-2 F9.4).
 * [por que] El agente necesita saber qué PROPIOS hallazgos introdujo su cambio,
 * no la lista entera del proyecto (la deuda heredada no es suya). Función pura:
 * el I/O (snapshot en disco, análisis) vive en la ruta y en el CLI. */
import { dirname } from 'node:path';
import type { HallazgoSentinel } from '../../../shared/types.js';

export interface ResultadoComparacion {
  /* Hallazgos actuales que no estaban en la base: los que cuenta el cierre. */
  nuevos: HallazgoSentinel[];
  /* Entradas de la base que ya no aparecen: informativo, no bloquea. */
  resueltos: number;
}

/* Clave sin número de línea. [por que] Editar código desplaza las líneas de
 * un hallazgo viejo: si la línea entrara en la clave, cada edición por encima
 * lo contaría como nuevo. Con fuente+regla+archivo, el mismo problema sigue
 * igualado aunque se mueva.
 * [por que] La severidad tampoco entra aquí, pero sí se mira al emparejar (ver
 * `compararHallazgos`): si entrara en la clave, bajar una severidad contaría
 * como un hallazgo nuevo y un arreglo a medias bloquearía el cierre. */
export function claveHallazgo(h: HallazgoSentinel): string {
  // [por que] `directorio-abarrotado` se reporta una vez por carpeta, pero Sentinel
  // le asigna el archivo que llega primero, y ese orden depende de la E/S. Con el
  // archivo en la clave, el mismo problema cambiaba de archivo entre ejecuciones y
  // contaba como nuevo; por eso aquí se iguala por carpeta.
  const sitio = h.ruleId === 'directorio-abarrotado' ? dirname(h.archivo) : h.archivo;
  return `${h.fuente ?? 'sentinel'}|${h.ruleId}|${sitio}`;
}

/* Gravedad creciente. Un valor que la tabla no reconozca cuenta como el más
 * leve: así una severidad que la herramienta no sepa nombrar nunca se lee
 * como empeoramiento. */
const GRAVEDAD = ['information', 'hint', 'warning', 'error'];

function rango(severidad: string | undefined): number {
  const i = GRAVEDAD.indexOf(severidad ?? '');
  return i < 0 ? 0 : i;
}

/* Comparación por multiconjunto: si la base tiene 2 hallazgos con la misma
 * clave y ahora hay 3, solo el tercero es nuevo. [por que] Un conjunto simple
 * ocultaría que un mismo fallo se ha duplicado en el mismo archivo.
 *
 * Dentro de la clave se empareja por severidad: un hallazgo actual es nuevo
 * salvo que la base tenga uno de la misma clave **igual o más grave** que le
 * corresponda. Así una escalada —`warning` en la base, `error` ahora— cuenta
 * como nuevo, que es lo que antes se colaba: `handlers/mod.rs` pasó de
 * `warning`@800 a `error`@803 en la misma línea y el cierre decía «0 nuevos».
 * Y al revés no dispara: si la severidad baja, el hallazgo se aparea y el
 * arreglo a medias no bloquea. */
export function compararHallazgos(
  base: readonly HallazgoSentinel[],
  actuales: readonly HallazgoSentinel[],
): ResultadoComparacion {
  const pendientes = new Map<string, HallazgoSentinel[]>();
  for (const h of base) {
    const k = claveHallazgo(h);
    const lista = pendientes.get(k);
    if (lista) lista.push(h);
    else pendientes.set(k, [h]);
  }
  /* De mayor a menor gravedad: al emparejar se gasta primero el más grave que
   * sirva, y quedan libres los leves por si el actual empeora. */
  for (const lista of pendientes.values()) {
    lista.sort((a, b) => rango(b.severidad) - rango(a.severidad));
  }

  const nuevos: HallazgoSentinel[] = [];
  for (const h of actuales) {
    const lista = pendientes.get(claveHallazgo(h)) ?? [];
    const mio = rango(h.severidad);
    /* El último que aún alcanza: el menos grave que sigue cubriendo al actual.
     * Se gasta el mínimo suficiente para no consumir un `error` de la base
     * cuando bastaba un `warning`. */
    let elegido = -1;
    for (let j = lista.length - 1; j >= 0; j -= 1) {
      if (rango(lista[j].severidad) >= mio) {
        elegido = j;
        break;
      }
    }
    if (elegido >= 0) lista.splice(elegido, 1);
    else nuevos.push(h);
  }

  let resueltos = 0;
  for (const lista of pendientes.values()) resueltos += lista.length;
  return { nuevos, resueltos };
}
