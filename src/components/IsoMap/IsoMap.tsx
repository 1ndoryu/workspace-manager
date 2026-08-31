/* Mapa isometrico del workspace: un tile por proyecto, color por estado.
 * [por que] Vista principal minimalista: SVG propio con proyeccion 2:1,
 * sin libreria de mapas. Color del tile segun estado git/gate. */
import { useMemo, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { TILE, iso, verticesPared, verticesTile } from './tiles.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import './isoMap.css';

type ColorEstado = 'limpio' | 'dirty' | 'rojo' | 'carpeta';

function estadoProyecto(p: Proyecto): ColorEstado {
  if (!p.esGit) return 'carpeta';
  if (p.git?.dirty) return 'dirty';
  if (p.gate?.declarado && !p.gate.gateDisponible) return 'rojo';
  return 'limpio';
}

export function IsoMap() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const [hover, setHover] = useState<Proyecto | null>(null);

  const proyectos = snapshot?.proyectos ?? [];

  /* Grid simple: N proyectos en filas de ancho fijo */
  const porFila = 8;
  const grid = useMemo(() => {
    return proyectos.map((p, i) => {
      const fila = Math.floor(i / porFila);
      const col = i % porFila;
      return { p, fila, col };
    });
  }, [proyectos]);

  /* Dimensiones del SVG */
  const filas = Math.ceil(proyectos.length / porFila);
  const margen = 80;
  const ancho = porFila * TILE.ancho * 2 + margen * 2;
  const alto = filas * TILE.alto * 1.6 + margen * 2;

  return (
    <div className="isoMapContenedor">
      <svg
        className="isoMapSvg"
        width={ancho}
        height={alto}
        viewBox={`0 0 ${ancho} ${alto}`}
        role="img"
        aria-label="Mapa isometrico de proyectos del area de trabajo"
      >
        {grid.map(({ p, fila, col }) => {
          const estado = estadoProyecto(p);
          const piso = verticesTile(col, fila, 0);
          const pared = verticesPared(col, fila, 0);
          const centro = iso(col, fila, 0, TILE.ancho, TILE.alto);
          return (
            <g
              key={p.id}
              className={`isoTile isoTile--${estado}`}
              onClick={() => seleccionar(p.id)}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') seleccionar(p.id);
              }}
            >
              <polygon points={pared} className="isoPared" />
              <polygon points={piso} className="isoPiso" />
              <text x={centro.x} y={centro.y + 4} className="isoEtiqueta" textAnchor="middle">
                {p.id.length > 14 ? p.id.slice(0, 13) + '…' : p.id}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && (
        <div className="isoTooltip">
          <strong>{hover.id}</strong>
          {hover.esGit && hover.git && (
            <div>
              <span className="isoTooltipRama">ramas: {hover.git.rama}</span>
              <span className="isoTooltipRama">dirty: {hover.git.dirty ? 'sí' : 'no'}</span>
              <span className="isoTooltipRama">ahead: {hover.git.ahead} · behind: {hover.git.behind}</span>
            </div>
          )}
          {!hover.esGit && <div className="isoTooltipRama">carpeta (no git)</div>}
        </div>
      )}
    </div>
  );
}
