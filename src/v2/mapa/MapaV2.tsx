/* Mapa v2 del workspace: vista monocroma en blanco y negro, sin radios,
 * sin sombras, sin bold. [por que] Reglas de diseño del front v2: los estados
 * se diferencian con patrones de relleno/borde, no con color. La logica de
 * interaccion (zoom, pan, arrastre, hover, tooltip) vive en useMapaV2. */
import { useMemo } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { ETIQUETA_ESTADO, estadoProyecto } from '../estado.js';
import { disponer } from './disposicion.js';
import {
  TILE,
  pathCuadricula,
  posicionGrid,
  verticesParedDer,
  verticesParedIzq,
  verticesTecho,
} from './tiles.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { LeyendaMapa } from './LeyendaMapa.js';
import { NodoMapa } from './NodoMapa.js';
import { ControlesMapa } from './ControlesMapa.js';
import { TooltipMapa } from './TooltipMapa.js';
import { useMapaV2 } from './useMapaV2.js';
import './mapaV2.css';

/* Los nodos de ubicacion son cajas mas altas que las de proyecto: se leen como
 * "plataformas" a las que se conectan. */
const ALTO_HUB = TILE.altoPared * 2;

/* Franja del pasillo (en celdas, respecto al centro de la caja) que ocupa cada
 * nodo; dentro de ella cada enlace recibe su propio carril. */
const FRANJA = { vps89: [0.55, 0.95], produccion: [1.05, 1.45], laptop: [-1.45, -0.55] } as const;

const corto = (t: string) => (t.length > 14 ? `${t.slice(0, 13)}…` : t);

export function MapaV2() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const dev = useWorkspaceStore((s) => s.dev);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);
  const {
    zoom,
    pan,
    modoArrastre,
    arrastrando,
    hover,
    tooltipPos,
    svgRef,
    acercar,
    alejar,
    alternarModoArrastre,
    iniciarArrastre,
    arrastrar,
    terminarArrastre,
    setHover,
    setTooltipPos,
  } = useMapaV2();

  const proyectos = snapshot?.proyectos ?? [];

  /* Claves con servicio en marcha (05AA-4): su enlace con la ubicacion brilla.
   * [por que] Solo bajo-mando = probe verde real; parado/deriva/sin-boton
   * no brillan. Excepcion explicita del usuario a la regla monocroma. */
  const enMarcha = useMemo(() => {
    const set = new Set<string>();
    for (const d of dev?.proyectos ?? []) {
      if (d.estado === 'bajo-mando') set.add(d.clave);
    }
    return set;
  }, [dev]);

  /* Tres nodos (laptop, VPS 89, produccion) y cada proyecto junto al suyo,
   * unido por una linea. Todo en celdas pares: una celda vacia entre cajas. */
  const { colocados, hubs, enlaces } = useMemo(() => disponer(proyectos, enMarcha), [proyectos, enMarcha]);

  /* Escena en orden de pintado iso: lo mas lejano (col+fila menor) primero,
   * para que las cajas cercanas tapen a las lejanas. */
  const escena = useMemo(() => {
    const items = [
      ...colocados.map((c) => ({ tipo: 'proyecto' as const, col: c.col, fila: c.fila, p: c.p })),
      ...hubs.map((h) => ({ tipo: 'hub' as const, col: h.col, fila: h.fila, h })),
    ];
    return items.sort((a, b) => a.col + a.fila - (b.col + b.fila) || a.col - b.col);
  }, [colocados, hubs]);

  /* Carril propio por enlace: reparte los de un mismo nodo a lo largo de su
   * franja, asi ninguna linea tapa a otra al compartir pasillo. */
  const carriles = useMemo(() => {
    const t = new Map<string, number>();
    (Object.keys(FRANJA) as (keyof typeof FRANJA)[]).forEach((id) => {
      const h = hubs.find((x) => x.id === id)!;
      const ls = enlaces
        .filter((e) => e.hasta === id)
        .sort((a, b) => Math.abs(b.desde.col - h.col) + Math.abs(b.desde.fila - h.fila) - (Math.abs(a.desde.col - h.col) + Math.abs(a.desde.fila - h.fila)) || a.clave.localeCompare(b.clave));
      const [lo, hi] = FRANJA[id];
      ls.forEach((e, i) => t.set(`${e.clave}-${id}`, ls.length < 2 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (ls.length - 1)));
    });
    return t;
  }, [enlaces, hubs]);

  /* Ruta por el suelo, por los pasillos impares (las celdas vacias entre cajas):
   * sale de la caja, corre en paralelo a la cuadricula y entra al nodo de lado. */
  const rutaSuelo = (e: (typeof enlaces)[number]) => {
    const h = hubs.find((x) => x.id === e.hasta)!;
    const s = carriles.get(`${e.clave}-${e.hasta}`)!;
    const celdas = [
      [e.desde.col, e.desde.fila],
      [e.desde.col, e.desde.fila + s],
      [h.col + s, e.desde.fila + s],
      [h.col + s, h.fila],
      [h.col, h.fila],
    ];
    return celdas.map(([c, f]) => { const p = posicionGrid(c, f); return `${p.x},${p.y}`; }).join(' ');
  };

  /* Rango de celdas ocupadas por cajas y nodos (para extender la cuadricula). */
  const rangoCeldas = useMemo(() => {
    if (escena.length === 0) return null;
    const cols = escena.map((g) => g.col);
    const filas = escena.map((g) => g.fila);
    return {
      minCol: Math.min(...cols),
      maxCol: Math.max(...cols),
      minFila: Math.min(...filas),
      maxFila: Math.max(...filas),
    };
  }, [escena]);

  /* Cuadricula extendida EXT celdas mas alla del contenido en cada direccion.
   * Como la extension es simetrica (misma EXT por los 4 lados), el centro de
   * la cuadricula coincide con el centro de las cajas y queda centrada. */
  const EXT = 6;

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
        {/* Halo para lo que esta vivo (isoglow: "lo encendido brilla"). Un solo
         * filtro compartido por el punto verde; sin el, el punto queda plano. */}
        <defs>
          <filter id="mapaV2Brillo" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="2.2" result="halo" />
            <feMerge>
              <feMergeNode in="halo" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Cuadricula iso de separacion, dibujada detras de las cajas.
         * Se extiende EXT celdas mas alla del contenido en cada direccion
         * (extension simetrica => centrado garantizado). */}
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
        {/* Lineas proyecto -> nodo, pegadas al suelo y bajo las cajas. Continua =
         * donde corre (verde y con halo si esta en marcha); discontinua = produccion. */}
        {enlaces.map((e) => (
          <polyline
            key={`${e.clave}-${e.hasta}`}
            points={rutaSuelo(e)}
            className={`mapaV2Enlace mapaV2Enlace--${e.hasta}`}
            filter={e.vivo ? 'url(#mapaV2Brillo)' : undefined}
          />
        ))}
        {escena.map((item) => {
          if (item.tipo === 'hub') {
            return <NodoMapa key={item.h.id} h={item.h} alto={ALTO_HUB} />;
          }
          const { p, fila, col } = item;
          const estado = estadoProyecto(p);
          const techo = verticesTecho(col, fila);
          const paredIzq = verticesParedIzq(col, fila);
          const paredDer = verticesParedDer(col, fila);
          return (
            <g
              key={p.id}
              className={`mapaV2Tile mapaV2Tile--${estado}${enMarcha.has(p.clave) ? ' mapaV2Tile--vivo' : ''}`}
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
              aria-label={`${p.id}, ${ETIQUETA_ESTADO[estado]}`}
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
        {/* Nombres en capa final: ninguna caja posterior los tapa. */}
        {colocados.map(({ p, col, fila }) => (
          <text
            key={`n-${p.clave}`}
            x={posicionGrid(col, fila).x}
            y={posicionGrid(col, fila).y + TILE.alto / 2 + 7}
            textAnchor="middle"
            className="mapaV2NombreProyecto"
          >
            {corto(p.id)}
          </text>
        ))}
      </svg>

      <ControlesMapa modoArrastre={modoArrastre} alternarModoArrastre={alternarModoArrastre} acercar={acercar} alejar={alejar} />

      <LeyendaMapa />

      {hover && tooltipPos && <TooltipMapa proyecto={hover} posicion={tooltipPos} />}
    </div>
  );
}
