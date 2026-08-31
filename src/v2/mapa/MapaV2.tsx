/* Mapa v2 del workspace: vista monocroma en blanco y negro, sin radios,
 * sin sombras, sin bold. [por que] Reglas de diseño del front v2: los estados
 * se diferencian con patrones de relleno/borde, no con color. */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { estadoProyecto, PESO_ESTADO } from '../estado.js';
import {
  TILE,
  pathCuadricula,
  verticesParedDer,
  verticesParedIzq,
  verticesTecho,
} from './tiles.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { Button } from '../Button.js';
import './mapaV2.css';

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
    console.warn('[mapaV2] no se pudo leer el estado guardado:', err);
    return null;
  }
}

/* Leido una sola vez por carga de pagina para inicializar zoom y pan. */
const estadoInicial = estadoGuardado();

export function MapaV2() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);
  const [hover, setHover] = useState<Proyecto | null>(null);
  /* Posicion del tooltip: sigue al cursor. [por que] Antes era fijo en la
   * esquina superior derecha y chocaria con el nuevo panel de lista. */
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  /* Zoom: 1 = escala completa (viewBox de la cuadricula extendida). Mayor
   * zoom => viewBox mas pequeno alrededor del centro => las cajas se ven
   * mas grandes. Se limita a un rango razonable. Se restaura desde
   * localStorage (estadoInicial) para que no se pierda al recargar. */
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
      console.warn('[mapaV2] no se pudo guardar el estado del mapa:', err);
    }
  }, [zoom, pan]);

  /* Modo mover (mano): al activarlo, arrastrar el puntero sobre el mapa lo
   * desplaza. [por que] Un unico boton de mano, como pidio el usuario: al dar
   * click se activa/desactiva el arrastre. Mientras esta activo, las cajas no
   * responden a click/hover (solo se mueve el mapa). */
  const [modoArrastre, setModoArrastre] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  /* Estado del arrastre en curso: punto de inicio en coordenadas del mundo y
   * pan inicial; el desplazamiento se calcula contra el punto actual. */
  const arrastre = useRef<{ inicioX: number; inicioY: number; panX: number; panY: number } | null>(null);

  const proyectos = snapshot?.proyectos ?? [];

  /* Grid: filas de ancho fijo, ordenadas por estado primero (repo/dirty/gate/carpeta) */
  const porFila = 8;
  const grid = useMemo(() => {
    const orden = [...proyectos].sort(
      (a, b) => PESO_ESTADO[estadoProyecto(a)] - PESO_ESTADO[estadoProyecto(b)],
    );
    return orden.map((p, i) => {
      /* Cajas en celdas PARES: cada caja ocupa una celda del tamano de la
       * caja y deja una celda vacia entre ellas como separacion. */
      const fila = Math.floor(i / porFila) * 2;
      const col = (i % porFila) * 2;
      return { p, fila, col };
    });
  }, [proyectos]);

  /* Rango de celdas ocupadas por las cajas (para extender la cuadricula). */
  const rangoCeldas = useMemo(() => {
    if (grid.length === 0) return null;
    const cols = grid.map((g) => g.col);
    const filas = grid.map((g) => g.fila);
    return {
      minCol: Math.min(...cols),
      maxCol: Math.max(...cols),
      minFila: Math.min(...filas),
      maxFila: Math.max(...filas),
    };
  }, [grid]);

  /* Cuadricula extendida EXT celdas mas alla del contenido en cada direccion.
   * Como la extension es simetrica (misma EXT por los 4 lados), el centro de
   * la cuadricula coincide con el centro de las cajas y todo queda centrado. */
  const EXT = 10;

  /* viewBox base (zoom 1, sin pan): bbox de la cuadricula extendida + margen.
   * [por que] Separado del viewBox final porque el arrastre solo necesita el
   * centro base para desplazarlo. Al ser la extension simetrica, el centro
   * coincide con el centro de las cajas. */
  const base = useMemo(() => {
    if (!rangoCeldas) return null;
    const margen = 80;
    const w = TILE.ancho / 2;
    const h = TILE.alto / 2;
    const { minCol, maxCol, minFila, maxFila } = rangoCeldas;
    // Lineas de rejilla en offsets 0.5; esquinas del rombo extremo.
    const minX = (minCol - EXT - 0.5 - (maxFila + EXT + 0.5)) * w;
    const maxX = (maxCol + EXT + 0.5 - (minFila - EXT - 0.5)) * w;
    const minY = (minCol - EXT - 0.5 + minFila - EXT - 0.5) * h;
    const maxY = (maxCol + EXT + 0.5 + maxFila + EXT + 0.5) * h;
    const anchoBase = maxX - minX + margen * 2;
    const altoBase = maxY - minY + margen * 2;
    return {
      cx: minX - margen + anchoBase / 2,
      cy: minY - margen + altoBase / 2,
      anchoBase,
      altoBase,
    };
  }, [rangoCeldas]);

  /* viewBox final: centro desplazado por pan y escalado por zoom alrededor
   * del centro (no de la esquina) para mantener el mapa centrado al
   * acercar/alejar. */
  const viewBox = useMemo(() => {
    if (!base) return '0 0 100 100';
    const ancho = base.anchoBase / zoom;
    const alto = base.altoBase / zoom;
    const cx = base.cx + pan.x;
    const cy = base.cy + pan.y;
    return `${cx - ancho / 2} ${cy - alto / 2} ${ancho} ${alto}`;
  }, [base, zoom, pan]);

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

  return (
    <div className="mapaV2">
      <svg
        ref={svgRef}
        className={`mapaV2Svg${modoArrastre ? ' mapaV2Svg--arrastre' : ''}${arrastrando ? ' mapaV2Svg--arrastrando' : ''}`}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mapa de proyectos del area de trabajo"
        onPointerDown={iniciarArrastre}
        onPointerMove={arrastrar}
        onPointerUp={terminarArrastre}
        onPointerCancel={terminarArrastre}
      >
        {/* Cuadricula iso de separacion, dibujada detras de las cajas.
         * Se extiende EXT celdas mas alla del contenido en cada direccion
         * (extension simetrica => todo queda centrado). */}
        {rangoCeldas && (
          <path
            d={pathCuadricula(
              rangoCeldas.minCol - EXT,
              rangoCeldas.maxCol + EXT,
              rangoCeldas.minFila - EXT,
              rangoCeldas.maxFila + EXT
            )}
            className="mapaV2Cuadricula"
          />
        )}
        {grid.map(({ p, fila, col }) => {
          const estado = estadoProyecto(p);
          const techo = verticesTecho(col, fila);
          const paredIzq = verticesParedIzq(col, fila);
          const paredDer = verticesParedDer(col, fila);
          return (
            <g
              key={p.id}
              className={`mapaV2Tile mapaV2Tile--${estado}`}
              onClick={() => {
                if (!modoArrastre) seleccionar(p.id);
              }}
              onContextMenu={(e) => {
                if (modoArrastre) return;
                e.preventDefault();
                abrirMenuContextual({ x: e.clientX, y: e.clientY, id: p.id, clave: p.clave });
              }}
              onMouseEnter={() => {
                if (!modoArrastre) setHover(p);
              }}
              onMouseMove={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => {
                setHover(null);
                setTooltipPos(null);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (!modoArrastre && (e.key === 'Enter' || e.key === ' ')) seleccionar(p.id);
              }}
            >
              {/* Orden de dibujo iso: paredes primero, techo encima. */}
              <polygon points={paredDer} className="mapaV2ParedDer" />
              <polygon points={paredIzq} className="mapaV2ParedIzq" />
              <polygon points={techo} className="mapaV2Piso" />
            </g>
          );
        })}
      </svg>

      {/* Controles del mapa (esquina superior derecha): mano (modo mover) y zoom. */}
      <div className="mapaV2Controles">
        <Button
          cuadrado
          activo={modoArrastre}
          onClick={() => {
            setModoArrastre((m) => !m);
            arrastre.current = null;
            setArrastrando(false);
            setHover(null);
          }}
          aria-label="Mover el mapa (arrastrar)"
          aria-pressed={modoArrastre}
          title={modoArrastre ? 'Modo mover activo: arrastra el mapa' : 'Activar modo mover: arrastra el mapa'}
        >
          {/* Icono de mano (pan_tool de Material) en monocromo: fill=currentColor
           * hereda el color del boton segun su estado. */}
          <svg className="mapaV2ManoIcono" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M23,5.5V20c0,2.2 -1.8,4 -4,4h-7.3c-1.08,0 -2.1,-0.43 -2.85,-1.19L1,14.83c0,0 -1.26,-1.38 0.3,-2.24c0.39,-0.23 0.86,-0.26 1.27,-0.03L6,15V4c0,-1.1 0.9,-2 2,-2s2,0.9 2,2v6h1V1.5c0,-0.83 0.67,-1.5 1.5,-1.5S14,0.67 14,1.5V10h1V2.5c0,-0.83 0.67,-1.5 1.5,-1.5S18,1.67 18,2.5V10h1V5.5c0,-0.83 0.67,-1.5 1.5,-1.5S22,4.67 22,5.5z"
              fill="currentColor"
            />
          </svg>
        </Button>
        <Button
          cuadrado
          className="botonV2--grande"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_PASO))}
          aria-label="Acercar"
          title="Acercar"
        >
          +
        </Button>
        <Button
          cuadrado
          className="botonV2--grande"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_PASO))}
          aria-label="Alejar"
          title="Alejar"
        >
          −
        </Button>
      </div>

      {hover && tooltipPos && (
        <div
          className="mapaV2Tooltip"
          style={{
            left: Math.min(tooltipPos.x + 14, window.innerWidth - 240),
            top: tooltipPos.y + 14,
          }}
        >
          <div className="mapaV2TooltipTitulo">{hover.id}</div>
          {hover.esGit && hover.git ? (
            <div className="mapaV2TooltipDatos">
              <div>rama: {hover.git.rama}</div>
              <div>dirty: {hover.git.dirty ? 'sí' : 'no'}</div>
              <div>ahead: {hover.git.ahead} · behind: {hover.git.behind}</div>
              {hover.gate?.declarado && <div>gate: sí</div>}
            </div>
          ) : (
            <div className="mapaV2TooltipDatos">carpeta (no git)</div>
          )}
        </div>
      )}
    </div>
  );
}
