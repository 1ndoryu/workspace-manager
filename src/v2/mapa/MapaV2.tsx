/* Mapa v2 del workspace: vista monocroma en blanco y negro, sin radios,
 * sin sombras, sin bold. [por que] Reglas de diseño del front v2: los estados
 * se diferencian con patrones de relleno/borde, no con color. */
import { useMemo, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import {
  TILE,
  pathCuadricula,
  posicionGrid,
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
      const fila = Math.floor(i / porFila);
      const col = i % porFila;
      return { p, fila, col };
    });
  }, [proyectos]);

  /* viewBox dinamico: se calcula a partir de las posiciones reales de las
   * cajas (techo + paredes). El margen generoso deja aire alrededor y hace
   * que las cajas se vean mas pequenas y menos apretadas. */
  const viewBox = useMemo(() => {
    if (grid.length === 0) return '0 0 100 100';
    const margen = 80;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { fila, col } of grid) {
      const c = posicionGrid(col, fila);
      minX = Math.min(minX, c.x - TILE.ancho / 2);
      maxX = Math.max(maxX, c.x + TILE.ancho / 2);
      minY = Math.min(minY, c.y - TILE.alto / 2);
      maxY = Math.max(maxY, c.y + TILE.alto / 2 + TILE.altoPared);
    }
    return `${minX - margen} ${minY - margen} ${maxX - minX + margen * 2} ${maxY - minY + margen * 2}`;
  }, [grid]);

  return (
    <div className="mapaV2">
      <svg
        className="mapaV2Svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mapa de proyectos del area de trabajo"
      >
        {/* Cuadricula iso de separacion, dibujada detras de las cajas. */}
        {grid.length > 0 && (
          <path
            d={pathCuadricula(porFila - 1, Math.max(...grid.map((g) => g.fila)))}
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

      <div className="mapaV2Leyenda">
        <span className="mapaV2LeyendaItem"><span className="mapaV2Muestra" /> caja = proyecto · pasa el cursor para ver detalles</span>
      </div>
    </div>
  );
}
