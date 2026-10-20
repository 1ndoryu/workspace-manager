/* Mapa v2 del workspace: vista monocroma en blanco y negro, sin radios,
 * sin sombras, sin bold. [por que] Reglas de diseño del front v2: los estados
 * se diferencian con patrones de relleno/borde, no con color. La logica de
 * interaccion (zoom, pan, arrastre, hover, tooltip) vive en useMapaV2. */
import { useCallback, useMemo, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { abrirPestana } from '../../shared/platform/plataforma.js';
import { ETIQUETA_ESTADO, estadoProyecto } from '../estado.js';
import { disponer } from './geometria/disposicion.js';
import { claveEnlace, puntoSalida, rutasDe } from './geometria/rutas.js';
import {
  pathCuadricula,
  degradadoBorde,
  textoRuta,
  verticesParedDer,
  verticesParedIzq,
  verticesTecho,
} from './geometria/tiles.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { EnlaceSuelo, NodoMapa, Troncales } from './NodoMapa.js';
import { BordeDev } from './BordeDev.js';
import { ControlesMapa } from './ControlesMapa.js';
import { ElegirUrl } from './ElegirUrl.js';
import { TooltipMapa } from './TooltipMapa.js';
import { useMapaV2 } from './useMapaV2.js';
import { urlsVivas, useConexiones } from '../useConexiones.js';
/* Escena, geometría de la cuadrícula y etiquetas en subcarpeta (límite de 300 líneas). */
import { calcularRango, escenaOrdenada, libresDe } from './MapaV2/escena.js';
import { ALTO_HUB, EXT, calcularBase, calcularViewBox } from './MapaV2/vista.js';
import { EtiquetasMapa } from './MapaV2/EtiquetasMapa.js';
import './mapaV2.css';

export function MapaV2() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);
  const {
    zoom,
    pan,
    arrastrando,
    hover,
    tooltipPos,
    abrirEn,
    setAbrirEn,
    svgRef,
    acercar,
    alejar,
    huboArrastre,
    iniciarArrastre,
    arrastrar,
    terminarArrastre,
    setHover,
    setTooltipPos,
  } = useMapaV2();

  const proyectos = snapshot?.proyectos ?? [];

  /* Quien corre y a donde: la misma respuesta que usa la lista para pintar sus cuadros. */
  const { enMarcha, enProd, destinos } = useConexiones();

  /* Click en una caja: abre el proyecto donde corre. Una sola direccion se abre directa; con
   * varias hay que elegir. [por que] Sin ninguna no hay nada que abrir, y entonces el click
   * selecciona, como antes: una caja parada no puede quedarse sin respuesta. */
  const activar = useCallback(
    (p: Proyecto, posicion: { x: number; y: number }) => {
      const urls = urlsVivas(p.urls, destinos.get(p.clave) ?? []);
      if (urls.length === 0) {
        seleccionar(p.id);
        return;
      }
      if (urls.length === 1) {
        abrirPestana(urls[0].url);
        return;
      }
      setHover(null);
      setTooltipPos(null);
      setAbrirEn({ id: p.id, urls, x: posicion.x, y: posicion.y });
    },
    [destinos, seleccionar, setAbrirEn, setHover, setTooltipPos],
  );

  /* Estable: si cambiara en cada render, el efecto de cierre de ElegirUrl se reinstalaria
   * constantemente y el pointerdown del propio menu lo cerraria. */
  const cerrarAbrirEn = useCallback(() => setAbrirEn(null), [setAbrirEn]);

  /* Centro de la caja en pantalla: posicion de partida cuando el click llega por teclado. */
  const centroDe = (el: SVGGElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  /* Nodo bajo el raton: solo entonces se muestra su nombre. */
  const [hubSobre, setHubSobre] = useState<string | null>(null);

  /* Tres nodos (laptop, VPS 89, produccion) y cada proyecto junto al suyo,
   * unido por una linea. Todo en celdas pares: una celda vacia entre cajas. */
  const { colocados, hubs, enlaces, troncales } = useMemo(() => disponer(proyectos, enMarcha, enProd), [proyectos, enMarcha, enProd]);

  /* Escena en orden de pintado iso: lo mas lejano (col+fila menor) primero,
   * para que las cajas cercanas tapen a las lejanas. */
  const escena = useMemo(() => escenaOrdenada(colocados, hubs), [colocados, hubs]);

  /* Rutas por el suelo (camino mas corto por los pasillos): en rutas.ts. */
  const rutas = useMemo(() => rutasDe(colocados, hubs, enlaces, troncales), [colocados, hubs, enlaces, troncales]);

  /* Claves sin ninguna linea: no corren en ningun sitio y el mapa las atenua, igual que su
   * cuadro en la lista de proyectos. Una sola regla para la caja y para su nombre. */
  const libres = useMemo(() => libresDe(colocados, enlaces), [colocados, enlaces]);

  /* Rango de celdas ocupadas (para extender la cuadricula, EXT celdas a cada lado). */
  const rangoCeldas = useMemo(() => calcularRango(escena), [escena]);

  /* Centro base del viewBox (zoom 1, sin pan) y el viewBox final con zoom y pan. */
  const base = useMemo(() => calcularBase(rangoCeldas), [rangoCeldas]);
  const viewBox = useMemo(() => calcularViewBox(base, zoom, pan), [base, zoom, pan]);

  return (
    <div className="mapaV2">
      <svg
        ref={svgRef}
        className={`mapaV2Svg${arrastrando ? ' mapaV2Svg--arrastrando' : ''}`}
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
              onClick={(e) => {
                /* Arrastrar empezo encima de esta caja: soltar no es un click. */
                if (huboArrastre()) return;
                activar(p, { x: e.clientX, y: e.clientY });
              }}
              onContextMenu={(e) => {
                if (arrastrando) return;
                e.preventDefault();
                abrirMenuContextual({ x: e.clientX, y: e.clientY, id: p.id, clave: p.clave });
              }}
              onMouseEnter={() => {
                if (!arrastrando) setHover(p);
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
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                activar(p, centroDe(e.currentTarget));
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
        {/* Etiquetas en capa final: ninguna caja posterior las tapa. */}
        <EtiquetasMapa hubs={hubs} hubSobre={hubSobre} colocados={colocados} libres={libres} />
      </svg>

      <ControlesMapa acercar={acercar} alejar={alejar} />

      {hover && tooltipPos && <TooltipMapa proyecto={hover} posicion={tooltipPos} />}

      {abrirEn && (
        <ElegirUrl
          id={abrirEn.id}
          urls={abrirEn.urls}
          posicion={{ x: abrirEn.x, y: abrirEn.y }}
          onCerrar={cerrarAbrirEn}
        />
      )}
    </div>
  );
}
