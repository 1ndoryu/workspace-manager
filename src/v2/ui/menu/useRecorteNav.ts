/* Cuantos destinos del panel central caben en el nav y cuantos sobran.
 * [por que] El panel central tiene 11 destinos con etiqueta y en ventanas
 * estrechas no caben: se recortaban contra el borde. Un breakpoint por media
 * query no sirve porque las etiquetas no miden lo mismo («mapa» frente a
 * «documentación»), asi que se mide el ancho real de cada boton. La medida se
 * toma sobre una fila oculta con los MISMOS botones: los visibles encogen al
 * recortarse y no sirven de regla.
 * [por que] Los toggles de visibilidad no entran en el recorte: son control
 * de paneles y el usuario pidio que no se oculten (2026-10-17). Su ancho se
 * descuenta, no se pliegan. */
import { useLayoutEffect, useRef, useState } from 'react';

export function useRecorteNav(nCentral: number) {
  const nav = useRef<HTMLElement>(null);
  const toggles = useRef<HTMLDivElement>(null);
  const medidor = useRef<HTMLDivElement>(null);
  const [cuantos, setCuantos] = useState(nCentral);

  /* useLayoutEffect, no useEffect: el primer render pinta todos los destinos y
   * se corregiria despues del pintado, con un parpadeo de recorte. */
  useLayoutEffect(() => {
    const barra = nav.current;
    const fila = medidor.current;
    if (!barra || !fila) return;

    const medir = () => {
      /* La fila oculta lleva un hijo de mas: el boton de sobra, que tambien
       * ocupa sitio y hay que descontar mientras quede algo fuera. */
      const hijos = [...fila.children] as HTMLElement[];
      if (hijos.length !== nCentral + 1) return;
      const estilo = getComputedStyle(barra);
      const anchoToggles = toggles.current?.offsetWidth ?? 0;
      const gapGrupos = anchoToggles > 0 ? parseFloat(estilo.columnGap) || 0 : 0;
      const disponible =
        barra.clientWidth -
        parseFloat(estilo.paddingLeft) -
        parseFloat(estilo.paddingRight) -
        anchoToggles -
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
    observador.observe(barra);
    /* El ancho disponible tambien cambia si cambian los toggles (en mapa son
     * tres y en el resto uno), y eso no redimensiona la barra. */
    if (toggles.current) observador.observe(toggles.current);
    /* La fuente es self-hosted con font-display:swap: hasta que carga, las
     * etiquetas miden con la mono del sistema y el recorte seria otro. */
    void document.fonts.ready.then(medir);
    return () => observador.disconnect();
  }, [nCentral]);

  return { nav, toggles, medidor, cuantos };
}
