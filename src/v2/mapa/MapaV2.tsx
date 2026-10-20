/* Mapa v2 del workspace: vista monocroma en blanco y negro, sin radios,
 * sin sombras, sin bold. [por que] Reglas de diseño del front v2: los estados
 * se diferencian con patrones de relleno/borde, no con color. La logica de
 * interaccion (zoom, pan, arrastre, hover, tooltip) vive en useMapaV2. */
import { useMemo, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { ETIQUETA_ESTADO, estadoProyecto } from '../estado.js';
import { disponer } from './geometria/disposicion.js';
import { claveEnlace, puntoSalida, rutasDe } from './geometria/rutas.js';
import {
  TILE,
  pathCuadricula,
  degradadoBorde,
  posicionGrid,
  textoRuta,
  verticesParedDer,
  verticesParedIzq,
  verticesTecho,
} from './geometria/tiles.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { EnlaceSuelo, NodoMapa, Troncales } from './NodoMapa.js';
import { BordeDev } from './BordeDev.js';
import { ControlesMapa } from './ControlesMapa.js';
import { TooltipMapa } from './TooltipMapa.js';
import { useMapaV2 } from './useMapaV2.js';
import { useConexiones } from '../useConexiones.js';
import './mapaV2.css';

/* Los nodos de ubicacion son cajas mas altas que las de proyecto: se leen como
 * "plataformas" a las que se conectan. */
const ALTO_HUB = TILE.altoPared * 2;

const corto = (t: string) => (t.length > 14 ? `${t.slice(0, 13)}…` : t);

export function MapaV2() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
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

  /* Quien corre y a donde: la misma respuesta que usa la lista para pintar sus cuadros. */
  const { enMarcha, enProd } = useConexiones();

  /* Nodo bajo el raton: solo entonces se muestra su nombre. */
  const [hubSobre, setHubSobre] = useState<string | null>(null);

  /* Tres nodos (laptop, VPS 89, produccion) y cada proyecto junto al suyo,
   * unido por una linea. Todo en celdas pares: una celda vacia entre cajas. */
  const { colocados, hubs, enlaces, troncales } = useMemo(() => disponer(proyectos, enMarcha, enProd), [proyectos, enMarcha, enProd]);

  /* Escena en orden de pintado iso: lo mas lejano (col+fila menor) primero,
   * para que las cajas cercanas tapen a las lejanas. */
  const escena = useMemo(() => {
    const items = [
      ...colocados.map((c) => ({ tipo: 'proyecto' as const, col: c.col, fila: c.fila, p: c.p })),
      ...hubs.map((h) => ({ tipo: 'hub' as const, col: h.col, fila: h.fila, h })),
    ];
    return items.sort((a, b) => a.col + a.fila - (b.col + b.fila) || a.col - b.col);
  }, [colocados, hubs]);

  /* Rutas por el suelo (camino mas corto por los pasillos): en rutas.ts. */
  const rutas = useMemo(() => rutasDe(colocados, hubs, enlaces, troncales), [colocados, hubs, enlaces, troncales]);

  /* Claves sin ninguna linea: no corren en ningun sitio y el mapa las atenua, igual que su
   * cuadro en la lista de proyectos. Una sola regla para la caja y para su nombre. */
  const libres = useMemo(() => {
    const conLinea = new Set(enlaces.map((e) => e.clave));
    return new Set(colocados.filter((c) => !conLinea.has(c.p.clave)).map((c) => c.p.clave));
  }, [colocados, enlaces]);

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
          {/* Brillo suave del borde degradado de las cajas conectadas. */}
          <filter id="mapaV2BrilloBorde" x="-40%" y="-40%" width="180%" height="190%">
            <feGaussianBlur stdDeviation="1.4" result="halo" />
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
        <Troncales troncales={troncales} hubs={hubs} atenuar={!!hover} />
        {enlaces.map((e) => (
          <EnlaceSuelo
            key={claveEnlace(e)}
            puntos={textoRuta(rutas.get(claveEnlace(e))!)}
            hasta={e.hasta}
            vivo={e.vivo}
            atenuar={!!hover && hover.clave !== e.clave}
          />
        ))}
        {escena.map((item) => {
          if (item.tipo === 'hub') {
            return <NodoMapa key={item.h.id} h={item.h} alto={ALTO_HUB} onSobre={setHubSobre} />;
          }
          const { p, fila, col } = item;
          const estado = estadoProyecto(p);
          const techo = verticesTecho(col, fila);
          const paredIzq = verticesParedIzq(col, fila);
          const paredDer = verticesParedDer(col, fila);
          /* Borde degradado del color de sus lineas, desde la cara por donde sale cada una. */
          const lineas = enlaces.filter((e) => e.clave === p.clave).map((e) => ({
            hasta: e.hasta,
            punto: puntoSalida(rutas.get(claveEnlace(e))!),
          }));
          const borde = degradadoBorde(col, fila, lineas);
          /* Sin lineas = no corre en ningun sitio: la caja se atenua, igual que su cuadro en la lista. */
          const libre = libres.has(p.clave);
          const idBorde = `mapaV2Borde-${col}-${fila}`;
          /* Trazo como atributo SVG: las reglas CSS de la caja no lo pisan. */
          const trazoBorde = borde ? `url(#${idBorde})` : undefined;
          return (
            <g
              key={p.id}
              className={`mapaV2Tile mapaV2Tile--${estado}${libre ? ' mapaV2Tile--libre' : ''}`}
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
              {borde && (
                <linearGradient id={idBorde} gradientUnits="userSpaceOnUse" x1={borde.x1} y1={borde.y1} x2={borde.x2} y2={borde.y2}>
                  <stop offset="0" stopColor={borde.colores[0]} />
                  <stop offset="1" stopColor={borde.colores[1]} />
                </linearGradient>
              )}
              {/* Orden iso: paredes y techo; el brillo solo si la caja tiene lineas. */}
              <g filter={borde ? 'url(#mapaV2BrilloBorde)' : undefined}>
                <polygon points={paredDer} className="mapaV2ParedDer" stroke={trazoBorde} />
                <polygon points={paredIzq} className="mapaV2ParedIzq" stroke={trazoBorde} />
                <polygon points={techo} className="mapaV2Piso" stroke={trazoBorde} />
              </g>
              {p.ejecucion?.modo === 'dev' && <BordeDev caras={[paredDer, paredIzq, techo]} />}
            </g>
          );
        })}
        {/* Nombres en capa final: ninguna caja posterior los tapa. */}
        {hubs.filter((h) => h.id === hubSobre).map((h) => (
          <text
            key={`e-${h.id}`}
            x={posicionGrid(h.col, h.fila).x}
            y={posicionGrid(h.col, h.fila).y - ALTO_HUB - TILE.alto / 2 - 5}
            textAnchor="middle"
            className="mapaV2HubEtiqueta"
          >
            {h.etiqueta} · {h.total}
          </text>
        ))}
        {/* Proyectos */}
        {/* Nombre tumbado sobre la cara superior, con la proyeccion 2:1 del suelo. */}
        {colocados.map(({ p, col, fila }) => {
          const c = posicionGrid(col, fila);
          return (
            <text
              key={`n-${p.clave}`}
              transform={`translate(${c.x} ${c.y - TILE.altoPared}) matrix(1 -0.5 1 0.5 0 0)`}
              textAnchor="middle"
              dominantBaseline="middle"
              className={`mapaV2NombreProyecto${libres.has(p.clave) ? ' mapaV2NombreProyecto--libre' : ''}`}
            >
              {corto(p.id)}
            </text>
          );
        })}
      </svg>

      <ControlesMapa modoArrastre={modoArrastre} alternarModoArrastre={alternarModoArrastre} acercar={acercar} alejar={alejar} />

      {hover && tooltipPos && <TooltipMapa proyecto={hover} posicion={tooltipPos} />}
    </div>
  );
}
