/* Cuantos destinos del panel central caben en el nav y cuantos sobran.
 * [por que] El panel central tiene 11 destinos con etiqueta y en ventanas
 * estrechas no caben: se recortaban contra el borde. Un breakpoint por media
 * query no sirve porque las etiquetas no miden lo mismo («mapa» frente a
 * «documentación»), asi que se mide el ancho real de cada boton. La medida se
 * toma sobre una fila oculta con los MISMOS botones: los visibles encogen al
 * recortarse y no sirven de regla.
 * [por que] Los grupos fijos (toggles de paneles, campana) no entran en el
 * recorte: son control de paneles y de avisos, y el usuario pidio que no se
 * oculten (2026-10-17). Su ancho se descuenta, no se pliegan.
 * [por que los descubre del DOM] Antes cada grupo se registraba a mano y el que
 * se olvidaba se comia el ancho sin que el recorte lo supiera (20AA-30 N4-2).
 * Ahora se miden TODOS los hijos de la barra que no son el central ni el
 * medidor: añadir un grupo a la derecha no exige tocar este hook. */
import { useLayoutEffect, useRef, useState } from 'react';

export function useRecorteNav(nCentral: number) {
  const nav = useRef<HTMLElement>(null);
  const medidor = useRef<HTMLDivElement>(null);
  /* El grupo central: el único hijo de la barra que se recorta. */
  const centralRef = useRef<HTMLDivElement>(null);
  const [cuantos, setCuantos] = useState(nCentral);

  /* useLayoutEffect, no useEffect: el primer render pinta todos los destinos y
   * se corregiria despues del pintado, con un parpadeo de recorte. */
  useLayoutEffect(() => {
    const barra = nav.current;
    const fila = medidor.current;
    const central = centralRef.current;
    if (!barra || !fila || !central) return;

    const medir = () => {
      /* La fila oculta lleva un hijo de mas: el boton de sobra, que tambien
       * ocupa sitio y hay que descontar mientras quede algo fuera. */
      const hijos = [...fila.children] as HTMLElement[];
      if (hijos.length !== nCentral + 1) return;
      const estilo = getComputedStyle(barra);
      /* Todos los grupos fijos, descubiertos del DOM: los hijos de la barra que no son el central
       * ni la fila de medida. Un grupo vacío (sin toggles en esta pestaña) no ocupa ni gap. */
      const grupos = ([...barra.children] as HTMLElement[]).filter((h) => h !== central && h !== fila);
      let anchoFijos = 0;
      let gruposFijos = 0;
      for (const grupo of grupos) {
        const ancho = grupo.offsetWidth;
        if (ancho === 0) continue;
        anchoFijos += ancho;
        gruposFijos += 1;
      }
      const gapGrupos = (parseFloat(estilo.columnGap) || 0) * gruposFijos;
      const disponible =
        barra.clientWidth -
        parseFloat(estilo.paddingLeft) -
        parseFloat(estilo.paddingRight) -
        anchoFijos -
        gapGrupos;
      const gap = parseFloat(getComputedStyle(fila).columnGap) || 0;
      const anchoSobra = hijos[nCentral].offsetWidth;
      let usado = 0;
      let caben = 0;
      for (let i = 0; i < nCentral; i++) {
        const ancho = usado + (i > 0 ? gap : 0) + hijos[i].offsetWidth;
        const conSobra = i + 1 < nCentral ? ancho + gap + anchoSobra : ancho;
        if (conSobra > disponible) break;
        usado = ancho;
        caben = i + 1;
      }
      setCuantos(caben);
    };

    medir();
    const observador = new ResizeObserver(medir);
    /* La barra no cambia de ancho cuando cambia el contenido de un grupo fijo (en mapa hay tres
     * toggles y en el resto uno), así que se observa cada grupo además de la barra. */
    /* La barra nunca cambia de ancho por dentro, y un grupo fijo sí (en mapa hay tres toggles y
     * en el resto uno): se observan los dos. Al montar ya están todos los grupos (el cambio de
     * pestaña no añade grupos, solo cambia su contenido), así que basta con los que hay. */
    for (const nodo of [barra, ...Array.from(barra.children as HTMLCollectionOf<HTMLElement>)]) {
      if (nodo !== fila) observador.observe(nodo);
    }
    /* La fuente es self-hosted con font-display:swap: hasta que carga, las
     * etiquetas miden con la mono del sistema y el recorte seria otro. */
    void document.fonts.ready.then(medir);
    return () => observador.disconnect();
  }, [nCentral]);

  return { nav, central: centralRef, medidor, cuantos };
}
