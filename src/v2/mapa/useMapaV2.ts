/* Hook del mapa v2: estado de interaccion (zoom, pan, modo mover, arrastre,
 * hover y tooltip) + persistencia en localStorage.
 * [por que] MapaV2 acumulaba 6 useState y 16 lineas de logica con estado
 * (reglas usestate-excesivo y componente-sin-hook-glory); extraerlo aqui
 * deja el componente como puro render + calculo derivado. La persistencia
 * sigue el mismo patron que AppV2 (logger central, no console directo). */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

/* Estado del mapa persistido entre recargas (zoom y posicion de arrastre).
 * [por que] El usuario pidio que al recargar la pagina no se pierdan. Se
 * guarda en localStorage; si no hay nada o el almacenamiento no esta
 * disponible, se parte del estado por defecto. */
interface EstadoMapaGuardado {
  zoom: number;
  pan: { x: number; y: number };
}

const CLAVE_ESTADO = 'mapaV2:estado';

function estadoGuardado(): EstadoMapaGuardado | null {
  try {
    const raw = localStorage.getItem(CLAVE_ESTADO);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<EstadoMapaGuardado>;
    if (typeof d.zoom !== 'number' || !d.pan || typeof d.pan.x !== 'number' || typeof d.pan.y !== 'number') {
      return null;
    }
    return { zoom: d.zoom, pan: { x: d.pan.x, y: d.pan.y } };
  } catch (err) {
    logger.warn('[mapaV2] no se pudo leer el estado guardado:', err);
    return null;
  }
}

/* Leido una sola vez por carga de pagina para inicializar zoom y pan. */
const estadoInicial = estadoGuardado();

export interface UseMapaV2 {
  zoom: number;
  pan: { x: number; y: number };
  modoArrastre: boolean;
  arrastrando: boolean;
  hover: Proyecto | null;
  tooltipPos: { x: number; y: number } | null;
  svgRef: React.RefObject<SVGSVGElement>;
  acercar: () => void;
  alejar: () => void;
  alternarModoArrastre: () => void;
  iniciarArrastre: (ev: ReactPointerEvent<SVGSVGElement>) => void;
  arrastrar: (ev: ReactPointerEvent<SVGSVGElement>) => void;
  terminarArrastre: () => void;
  setHover: (p: Proyecto | null) => void;
  setTooltipPos: (p: { x: number; y: number } | null) => void;
}

export function useMapaV2(): UseMapaV2 {
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const ZOOM_PASO = 0.5;
  const [zoom, setZoom] = useState(() => {
    if (!estadoInicial) return 1;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, estadoInicial.zoom));
  });

  /* Navegacion (pan): desplazamiento del centro del viewBox en unidades del
   * mundo. Se restaura desde localStorage igual que el zoom. */
  const [pan, setPan] = useState(() =>
    estadoInicial ? { x: estadoInicial.pan.x, y: estadoInicial.pan.y } : { x: 0, y: 0 },
  );

  /* Persiste zoom y pan en cada cambio para sobrevivir a recargas. */
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_ESTADO, JSON.stringify({ zoom, pan } satisfies EstadoMapaGuardado));
    } catch (err) {
      logger.warn('[mapaV2] no se pudo guardar el estado del mapa:', err);
    }
  }, [zoom, pan]);

  /* Modo mover (mano): al activarlo, arrastrar el puntero sobre el mapa lo
   * desplaza. [por que] Un unico boton de mano, como pidio el usuario: al dar
   * click se activa/desactiva el arrastre. Mientras esta activo, las cajas no
   * responden a click/hover (solo se mueve el mapa). */
  const [modoArrastre, setModoArrastre] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [hover, setHover] = useState<Proyecto | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  /* Estado del arrastre en curso: punto de inicio en coordenadas del mundo y
   * pan inicial; el desplazamiento se calcula contra el punto actual. */
  const arrastre = useRef<{ inicioX: number; inicioY: number; panX: number; panY: number } | null>(null);

  /* Convierte coordenadas de pantalla a unidades del mundo del viewBox usando
   * la matriz real del SVG (getScreenCTM). [por que] El arrastre debe seguir
   * al puntero exactamente a cualquier zoom; una conversion por tamano del
   * contenedor se desviaria con preserveAspectRatio meet. */
  function puntoSvg(ev: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function iniciarArrastre(ev: ReactPointerEvent<SVGSVGElement>) {
    if (!modoArrastre) return;
    const pt = puntoSvg(ev);
    if (!pt) return;
    arrastre.current = { inicioX: pt.x, inicioY: pt.y, panX: pan.x, panY: pan.y };
    setArrastrando(true);
    /* [por que] Captura solo con eventos reales: los sinteticos (tests) no
     * tienen puntero activo y setPointerCapture lanzaria excepcion. Con
     * captura, el arrastre sigue aunque el puntero salga del SVG. */
    if (ev.isTrusted) ev.currentTarget.setPointerCapture(ev.pointerId);
  }

  function arrastrar(ev: ReactPointerEvent<SVGSVGElement>) {
    const a = arrastre.current;
    if (!a) return;
    const pt = puntoSvg(ev);
    if (!pt) return;
    /* [por que] Resta el desplazamiento: el mapa sigue al cursor (semantica
     * de agarrar y arrastrar). Si se sumara, el contenido se moveria en
     * sentido contrario al puntero. */
    setPan({ x: a.panX - (pt.x - a.inicioX), y: a.panY - (pt.y - a.inicioY) });
  }

  function terminarArrastre() {
    arrastre.current = null;
    setArrastrando(false);
  }

  return {
    zoom,
    pan,
    modoArrastre,
    arrastrando,
    hover,
    tooltipPos,
    svgRef,
    acercar: () => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_PASO)),
    alejar: () => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_PASO)),
    alternarModoArrastre: () => {
      setModoArrastre((m) => !m);
      arrastre.current = null;
      setArrastrando(false);
      setHover(null);
    },
    iniciarArrastre,
    arrastrar,
    terminarArrastre,
    setHover,
    setTooltipPos,
  };
}
