/* Etiquetas del mapa v2: nombre del nodo bajo el puntero y nombres tumbados sobre cada caja.
 * [por que] Van en la capa final del SVG: ninguna caja posterior las tapa. */
import type { Colocado, Hub } from '../geometria/disposicion.js';
import { TILE, posicionGrid } from '../geometria/tiles.js';
import { ALTO_HUB } from './vista.js';

const corto = (t: string) => (t.length > 14 ? `${t.slice(0, 13)}…` : t);

interface Props {
  hubs: Hub[];
  hubSobre: string | null;
  colocados: Colocado[];
  libres: ReadonlySet<string>;
}

export function EtiquetasMapa({ hubs, hubSobre, colocados, libres }: Props) {
  return (
    <>
      {/* Nodo bajo el ratón: su nombre y cuántos proyectos enlaza. */}
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
      {/* Nombre tumbado sobre la cara superior, con la proyección 2:1 del suelo. */}
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
    </>
  );
}
