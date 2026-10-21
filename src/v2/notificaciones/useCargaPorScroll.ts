/* Carga diferida por scroll (20AA-29): pinta un tramo y suma otro al llegar al final.
 * [por que un hook] Pagina la página de avisos (la campana pinta todos sus grupos): separa la
 * regla —cuántos se pintan y cuándo se suman— de la mecánica del contenedor, y no toca el DOM
 * salvo para saber si la lista está al final.
 * [por que por grupos y no por filas] Un tramo de 6 h a medias se completaría al bajar y la lista
 * parecería reordenarse; se suman grupos completos (ver `tramoVisible`).
 * [por que no `IntersectionObserver`] Requiere un centinela en el DOM y limpiar el observador al
 * desmontar; el evento `scroll` de un contenedor propio es una línea y este hook no se queda sin
 * quien lo escuche. */
import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import type { GrupoTiempo } from '../../shared/notificaciones/presentacion.js';
import { AVISOS_POR_TRAMO, tramoVisible } from '../../shared/notificaciones/presentacion.js';

/* Margen con el que se pide el tramo siguiente antes de tocar el borde: si se espera al final
 * exacto, quien desplaza rápido ve un salto. */
const MARGEN_PX = 200;

export function useCargaPorScroll(grupos: readonly GrupoTiempo[]) {
  const [tope, setTope] = useState(AVISOS_POR_TRAMO);
  const refLista = useRef<HTMLDivElement>(null);
  const ultimaFirma = useRef('');

  const { grupos: gruposVisibles, quedan } = tramoVisible(grupos, tope);

  /* Un filtro nuevo o una lista distinta vuelve al primer tramo: seguir con un tope de 400 en una
   * lista de 12 no pinta nada más, pero deja el estado mintiendo para cuando crezca. */
  const firma = `${grupos.length}:${grupos[0]?.clave ?? 'x'}`;
  useEffect(() => {
    if (ultimaFirma.current === '') {
      ultimaFirma.current = firma;
      return;
    }
    if (ultimaFirma.current !== firma) {
      ultimaFirma.current = firma;
      setTope(AVISOS_POR_TRAMO);
    }
  }, [firma]);

  const verMas = useCallback(() => {
    setTope((t) => t + AVISOS_POR_TRAMO);
  }, []);

  const alDesplazar = useCallback(
    (ev: UIEvent<HTMLDivElement>) => {
      const el = ev.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight > MARGEN_PX) return;
      /* Si no queda nada, no se toca el estado: un `setState` por cada evento del final repinta
       * la lista entera en vano. */
      if (quedan === 0) return;
      verMas();
    },
    [quedan, verMas],
  );

  return { gruposVisibles, quedan, refLista, alDesplazar, verMas };
}
