/* Hook del mapa v2: estado de interaccion (zoom, pan, arrastre, pinza, rueda,
 * hover y tooltip) + persistencia en localStorage.
 * [por que] MapaV2 acumulaba 6 useState y 16 lineas de logica con estado
 * (reglas usestate-excesivo y componente-sin-hook-glory); extraerlo aqui
 * deja el componente como puro render + calculo derivado. La persistencia
 * sigue el mismo patron que AppV2 (logger central, no console directo). */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Proyecto, UrlDestino } from '../../shared/types.js';
import { guardarJson, leerJson } from '../../shared/vista/storage.js';

/* Estado del mapa persistido entre recargas (zoom y posicion de arrastre).
 * [por que] El usuario pidio que al recargar la pagina no se pierdan. Se
 * guarda en localStorage; si no hay nada o el almacenamiento no esta
 * disponible, se parte del estado por defecto. */
interface EstadoMapaGuardado {
  zoom: number;
  pan: { x: number; y: number };
}

const CLAVE_ESTADO = 'mapaV2:estado';

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASO = 0.5;

/* Cuanto tiene que moverse el puntero (px de pantalla) para que sea un arrastre y no un
 * click. Por debajo, el click de la caja sigue contando. */
const UMBRAL_ARRASTRE = 4;

function limitarZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function estadoGuardado(): EstadoMapaGuardado | null {
  const d = leerJson<Partial<EstadoMapaGuardado>>(
    CLAVE_ESTADO,
    '[mapaV2] no se pudo leer el estado guardado:',
  );
  if (
    !d ||
    typeof d.zoom !== 'number' ||
    !d.pan ||
    typeof d.pan.x !== 'number' ||
    typeof d.pan.y !== 'number'
  ) {
    return null;
  }
  return { zoom: d.zoom, pan: { x: d.pan.x, y: d.pan.y } };
}

/* Leido una sola vez por carga de pagina para inicializar zoom y pan. */
const estadoInicial = estadoGuardado();

export interface UseMapaV2 {
  zoom: number;
  pan: { x: number; y: number };
  arrastrando: boolean;
  hover: Proyecto | null;
  tooltipPos: { x: number; y: number } | null;
  /* Eleccion pendiente de destino: el proyecto corre en varios sitios y hay que decir cual.
   * Null cuando no hay ninguna pregunta abierta. */
  abrirEn: { id: string; urls: UrlDestino[]; x: number; y: number } | null;
  setAbrirEn: (v: { id: string; urls: UrlDestino[]; x: number; y: number } | null) => void;
  svgRef: React.RefObject<SVGSVGElement>;
  acercar: () => void;
  alejar: () => void;
  iniciarArrastre: (ev: ReactPointerEvent<SVGSVGElement>) => void;
  arrastrar: (ev: ReactPointerEvent<SVGSVGElement>) => void;
  terminarArrastre: (ev: ReactPointerEvent<SVGSVGElement>) => void;
  /* True si la ultima interaccion movio el mapa: la caja que quedo debajo del puntero no debe
   * seleccionarse al soltar. */
  huboArrastre: () => boolean;
  setHover: (p: Proyecto | null) => void;
  setTooltipPos: (p: { x: number; y: number } | null) => void;
}

export function useMapaV2(): UseMapaV2 {
  /* Zoom y pan van juntos en un solo estado: acercar con los dedos o con la rueda mueve los
   * dos a la vez (el punto bajo los dedos se queda donde esta), y separarlos obligaba a
   * encadenar dos actualizaciones que se pisaban. */
  const [vista, setVista] = useState<{ zoom: number; pan: { x: number; y: number } }>(() => ({
    zoom: estadoInicial ? limitarZoom(estadoInicial.zoom) : 1,
    pan: estadoInicial ? { x: estadoInicial.pan.x, y: estadoInicial.pan.y } : { x: 0, y: 0 },
  }));

  /* Persiste zoom y pan en cada cambio para sobrevivir a recargas. */
  useEffect(() => {
    guardarJson(
      CLAVE_ESTADO,
      { zoom: vista.zoom, pan: vista.pan } satisfies EstadoMapaGuardado,
      '[mapaV2] no se pudo guardar el estado del mapa:',
    );
  }, [vista]);

  const [arrastrando, setArrastrando] = useState(false);
  const [hover, setHover] = useState<Proyecto | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [abrirEn, setAbrirEn] = useState<{ id: string; urls: UrlDestino[]; x: number; y: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  /* Estado del arrastre en curso: punto de agarre en pixeles de pantalla, pan inicial y la
   * escala real de la pantalla a unidades del mundo. */
  const arrastre = useRef<{
    cx: number;
    cy: number;
    panX: number;
    panY: number;
    escalaX: number;
    escalaY: number;
  } | null>(null);
  /* Desplazamiento pendiente de aplicar y fotograma ya pedido. */
  const pendiente = useRef<{ dx: number; dy: number } | null>(null);
  const fotograma = useRef<number | null>(null);
  /* Si la interaccion en curso ya movio el mapa. */
  const movido = useRef(false);
  /* Punteros apoyados ahora mismo (dedos o raton), por id. */
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  /* Pinza en curso: separacion entre los dos dedos en el paso anterior. */
  const pinza = useRef<number | null>(null);

  /* Escala de pantalla a unidades del mundo (getScreenCTM). [por que] Se lee UNA vez, al
   * empezar el gesto: el viewBox cambia con el pan, asi que convertir el punto en cada
   * movimiento realimentaba el propio desplazamiento —cada pan cambiaba la conversion del
   * siguiente— y el mapa temblaba. Con pixeles de pantalla el desplazamiento es exacto. */
  function escalaPantalla(): { x: number; y: number } | null {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm || ctm.a === 0 || ctm.d === 0) return null;
    return { x: ctm.a, y: ctm.d };
  }

  function panCon(dx: number, dy: number) {
    const a = arrastre.current;
    if (!a) return;
    setVista((v) => ({ ...v, pan: { x: a.panX - dx / a.escalaX, y: a.panY - dy / a.escalaY } }));
  }

  /* [por que] pointermove llega mas veces que fotogramas y cada actualizacion re-renderiza el
   * mapa entero: se guarda el ultimo desplazamiento y se aplica uno por fotograma. */
  function aplicarPendiente() {
    fotograma.current = null;
    const p = pendiente.current;
    if (p) panCon(p.dx, p.dy);
  }

  useEffect(
    () => () => {
      if (fotograma.current !== null) cancelAnimationFrame(fotograma.current);
    },
    [],
  );

  /* Zoom anclado en un punto de la pantalla: lo que hay bajo el cursor (o entre los dos dedos)
   * se queda donde esta. [por que] El centro del viewBox cae en el centro del SVG
   * (preserveAspectRatio xMidYMid), asi que el desplazamiento en unidades del mundo respecto al
   * centro es la distancia en pantalla entre el punto y ese centro, dividida por la escala. */
  function zoomEn(factor: number, punto: { x: number; y: number }) {
    const svg = svgRef.current;
    const escala = escalaPantalla();
    if (!svg || !escala) return;
    const r = svg.getBoundingClientRect();
    const dx = (punto.x - (r.left + r.width / 2)) / escala.x;
    const dy = (punto.y - (r.top + r.height / 2)) / escala.y;
    setVista((v) => {
      const z1 = limitarZoom(v.zoom * factor);
      if (z1 === v.zoom) return v;
      /* k: cuanto se desplaza el centro del viewBox para que el punto anclado no se mueva. */
      const k = 1 - v.zoom / z1;
      return { zoom: z1, pan: { x: v.pan.x + dx * k, y: v.pan.y + dy * k } };
    });
  }

  /* Captura del puntero: se toma cuando el gesto YA es un gesto (arrastre pasado el umbral o
   * pinza), nunca al apoyar el dedo. [por que] Con captura desde el `pointerdown` el navegador
   * entrega el `click` al SVG que captura y no a la caja: el click de la caja no llegaba casi
   * nunca. Capturando despues, el click sigue siendo de la caja y el arrastre no se pierde al
   * salir del SVG. Solo con eventos reales: los sinteticos (tests) no tienen puntero activo y
   * `setPointerCapture` lanzaria excepcion. */
  function capturar(ev: ReactPointerEvent<SVGSVGElement>) {
    if (ev.isTrusted) ev.currentTarget.setPointerCapture(ev.pointerId);
  }

  function iniciarArrastre(ev: ReactPointerEvent<SVGSVGElement>) {
    punteros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    /* Dos dedos: manda la pinza, no el arrastre. */
    if (punteros.current.size >= 2) {
      arrastre.current = null;
      pendiente.current = null;
      pinza.current = separacionPunteros();
      movido.current = true;
      capturar(ev);
      setArrastrando(false);
      setHover(null);
      setTooltipPos(null);
      return;
    }

    const escala = escalaPantalla();
    if (!escala) return;
    arrastre.current = {
      cx: ev.clientX,
      cy: ev.clientY,
      panX: vista.pan.x,
      panY: vista.pan.y,
      escalaX: escala.x,
      escalaY: escala.y,
    };
    pendiente.current = null;
    movido.current = false;
    setArrastrando(true);
  }

  function separacionPunteros(): number | null {
    const [a, b] = [...punteros.current.values()];
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function centroPunteros(): { x: number; y: number } | null {
    const [a, b] = [...punteros.current.values()];
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function arrastrar(ev: ReactPointerEvent<SVGSVGElement>) {
    if (punteros.current.has(ev.pointerId)) {
      punteros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }

    /* Pinza de dos dedos: el factor de zoom es cuanto crece la separacion entre ellos. */
    if (pinza.current !== null) {
      const dist = separacionPunteros();
      const centro = centroPunteros();
      if (dist === null || centro === null) return;
      capturar(ev);
      if (pinza.current > 0 && dist > 0) zoomEn(dist / pinza.current, centro);
      pinza.current = dist;
      return;
    }

    if (!arrastre.current) return;
    const dx = ev.clientX - arrastre.current.cx;
    const dy = ev.clientY - arrastre.current.cy;
    if (!movido.current) {
      if (Math.abs(dx) + Math.abs(dy) < UMBRAL_ARRASTRE) return;
      movido.current = true;
      /* Ya es un arrastre, no un click: a partir de aqui el puntero se captura. */
      capturar(ev);
    }
    pendiente.current = { dx, dy };
    if (fotograma.current === null) fotograma.current = requestAnimationFrame(aplicarPendiente);
  }

  function terminarArrastre(ev: ReactPointerEvent<SVGSVGElement>) {
    punteros.current.delete(ev.pointerId);
    if (punteros.current.size < 2) pinza.current = null;

    if (fotograma.current !== null) {
      cancelAnimationFrame(fotograma.current);
      fotograma.current = null;
    }
    /* El ultimo tramo no se pierde: se aplica antes de soltar. */
    const p = pendiente.current;
    if (movido.current && p) panCon(p.dx, p.dy);
    pendiente.current = null;
    arrastre.current = null;
    setArrastrando(false);
  }

  /* Rueda del raton y del touchpad. [por que] El gesto de pinza del touchpad no llega como
   * pointerdown: el navegador lo sintetiza como rueda con `ctrlKey`. La rueda a secas (dos
   * dedos deslizando) desplaza el mapa, como en cualquier lienzo. */
  function rueda(ev: WheelEvent) {
    ev.preventDefault();
    if (ev.ctrlKey) {
      zoomEn(Math.exp(-ev.deltaY / 200), { x: ev.clientX, y: ev.clientY });
      return;
    }
    const escala = escalaPantalla();
    if (!escala) return;
    setVista((v) => ({
      ...v,
      pan: { x: v.pan.x + ev.deltaX / escala.x, y: v.pan.y + ev.deltaY / escala.y },
    }));
  }

  /* [por que] React registra `wheel` como pasivo en la raiz, asi que `preventDefault` desde
   * `onWheel` no frena el zoom de la pagina: el oyente va nativo y sin pasividad. El ref
   * guarda siempre el ultimo handler, porque el oyente se instala una sola vez. */
  const ruedaRef = useRef(rueda);
  useEffect(() => {
    ruedaRef.current = rueda;
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const alRueda = (ev: WheelEvent) => ruedaRef.current(ev);
    svg.addEventListener('wheel', alRueda, { passive: false });
    return () => svg.removeEventListener('wheel', alRueda);
  }, []);

  return {
    zoom: vista.zoom,
    pan: vista.pan,
    arrastrando,
    hover,
    tooltipPos,
    abrirEn,
    setAbrirEn,
    svgRef,
    acercar: () => setVista((v) => ({ ...v, zoom: limitarZoom(v.zoom + ZOOM_PASO) })),
    alejar: () => setVista((v) => ({ ...v, zoom: limitarZoom(v.zoom - ZOOM_PASO) })),
    iniciarArrastre,
    arrastrar,
    terminarArrastre,
    huboArrastre: () => movido.current,
    setHover,
    setTooltipPos,
  };
}
