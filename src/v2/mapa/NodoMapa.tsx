/* Nodo de ubicación (laptop, VPS 89, producción): caja alta (la etiqueta va en la capa final del mapa). */
import type { Hub } from './disposicion.js';
import { verticesParedDer, verticesParedIzq, verticesTecho } from './tiles.js';

export function NodoMapa({ h, alto }: { h: Hub; alto: number }) {
  return (
    <g className={`mapaV2Hub mapaV2Hub--${h.id}`}>
      <title>{`${h.etiqueta}: ${h.total} enlaces`}</title>
      <polygon points={verticesParedDer(h.col, h.fila, alto)} className="mapaV2HubPared" />
      <polygon points={verticesParedIzq(h.col, h.fila, alto)} className="mapaV2HubPared" />
      <polygon points={verticesTecho(h.col, h.fila, alto)} className="mapaV2HubTecho" />
    </g>
  );
}
