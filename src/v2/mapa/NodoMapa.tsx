/* Nodo de ubicación (laptop, VPS 89, producción): caja alta con su etiqueta. */
import type { Hub } from './disposicion.js';
import { TILE, posicionGrid, verticesParedDer, verticesParedIzq, verticesTecho } from './tiles.js';

export function NodoMapa({ h, alto }: { h: Hub; alto: number }) {
  const c = posicionGrid(h.col, h.fila);
  return (
    <g className={`mapaV2Hub mapaV2Hub--${h.id}`}>
      <title>{`${h.etiqueta}: ${h.total} enlaces`}</title>
      <polygon points={verticesParedDer(h.col, h.fila, alto)} className="mapaV2HubPared" />
      <polygon points={verticesParedIzq(h.col, h.fila, alto)} className="mapaV2HubPared" />
      <polygon points={verticesTecho(h.col, h.fila, alto)} className="mapaV2HubTecho" />
      <text x={c.x} y={c.y - alto - TILE.alto / 2 - 5} textAnchor="middle" className="mapaV2HubEtiqueta">
        {h.etiqueta} · {h.total}
      </text>
    </g>
  );
}
