/* Mapa v2 del workspace: vista monocroma en blanco y negro, sin radios,
 * sin sombras, sin bold. [por que] Reglas de diseño del front v2: los estados
 * se diferencian con patrones de relleno/borde, no con color. */
import { useMemo, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import {
  TILE,
  pathCuadricula,
  verticesBase,
  verticesParedDer,
  verticesParedIzq,
  verticesTecho,
} from './tiles.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import './mapaV2.css';

type EstadoTile = 'repo' | 'dirty' | 'gate' | 'carpeta';

function estadoProyecto(p: Proyecto): EstadoTile {
  if (!p.esGit) return 'carpeta';
  if (p.git?.dirty) return 'dirty';
  if (p.gate?.declarado) return 'gate';
  return 'repo';
}

export function MapaV2() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const [hover, setHover] = useState<Proyecto | null>(null);
  /* Zoom: 1 = escala completa (viewBox de la cuadricula extendida). Mayor
   * zoom => viewBox mas pequeno alrededor del centro => las cajas se ven
   * mas grandes. Se limita a un rango razonable. */
  const [zoom, setZoom] = useState(1);
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const ZOOM_PASO = 0.5;

  const proyectos = snapshot?.proyectos ?? [];

  /* Grid: filas de ancho fijo, ordenadas por estado primero (repo/dirty/gate/carpeta) */
  const porFila = 8;
  const grid = useMemo(() => {
    const orden = [...proyectos].sort((a, b) => {
      const na = estadoProyecto(a);
      const nb = estadoProyecto(b);
      const peso: Record<EstadoTile, number> = { repo: 0, dirty: 1, gate: 2, carpeta: 3 };
      return peso[na] - peso[nb];
    });
    return orden.map((p, i) => {
      /* Cajas en celdas PARES: cada caja ocupa una celda del tamano de la
       * caja y deja una celda vacia entre ellas como separacion. */
      const fila = Math.floor(i / porFila) * 2;
      const col = (i % porFila) * 2;
      return { p, fila, col };
    });
  }, [proyectos]);

  /* viewBox dinamico: se calcula a partir de las posiciones reales de las
   * cajas (techo + paredes). El margen generoso deja aire alrededor y hace
   * que las cajas se vean mas pequenas y menos apretadas. */
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

  /* viewBox dinamico: abarca la cuadricula extendida (que cubre las cajas).
   * [por que] Usamos el bbox de la rejilla extendida + margen: al ser
   * simetrica respecto a las cajas, estas quedan centradas en pantalla y la
   * rejilla se percibe completa mas alla del contenido. El zoom escala el
   * viewBox alrededor del centro (no de la esquina) para mantener el mapa
   * centrado al acercar/alejar. */
  const viewBox = useMemo(() => {
    if (!rangoCeldas) return '0 0 100 100';
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
    // Centro del viewBox base.
    const cx = minX - margen + anchoBase / 2;
    const cy = minY - margen + altoBase / 2;
    // Escalar alrededor del centro: viewBox mas pequeno = mas zoom.
    const ancho = anchoBase / zoom;
    const alto = altoBase / zoom;
    return `${cx - ancho / 2} ${cy - alto / 2} ${ancho} ${alto}`;
  }, [rangoCeldas, zoom]);

  return (
    <div className="mapaV2">
      <svg
        className="mapaV2Svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mapa de proyectos del area de trabajo"
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
              onClick={() => seleccionar(p.id)}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') seleccionar(p.id);
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

      {/* Controles de zoom en la esquina superior derecha del mapa. */}
      <div className="mapaV2Zoom">
        <button
          type="button"
          className="mapaV2ZoomBoton"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_PASO))}
          aria-label="Acercar"
          title="Acercar"
        >
          +
        </button>
        <button
          type="button"
          className="mapaV2ZoomBoton"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_PASO))}
          aria-label="Alejar"
          title="Alejar"
        >
          −
        </button>
      </div>

      {hover && (
        <div className="mapaV2Tooltip">
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
