/* Nodo de ubicación (laptop, VPS 89, producción): caja alta (la etiqueta va en la capa final del mapa). */
import { rutaTroncal, type Hub, type Troncal } from './disposicion.js';
import { COLOR_HUB, posicionGrid, verticesParedDer, verticesParedIzq, verticesTecho } from './tiles.js';

/* Enlaces entre nodos, pegados al suelo: degradado del color de un nodo al del otro.
 * [por que] Userspace: el degradado va de centro a centro de los nodos, no de la caja del trazo. */
export function Troncales({ troncales, hubs, atenuar }: { troncales: Troncal[]; hubs: Hub[]; atenuar: boolean }) {
  return (
    <g className={atenuar ? 'mapaV2Enlace--ajeno' : undefined}>
      {troncales.map((t) => {
        const id = `mapaV2Troncal-${t.de}-${t.a}`;
        const a = hubs.find((h) => h.id === t.de)!;
        const b = hubs.find((h) => h.id === t.a)!;
        const pa = posicionGrid(a.col, a.fila);
        const pb = posicionGrid(b.col, b.fila);
        return (
          <g key={id}>
            <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}>
              <stop offset="0" stopColor={COLOR_HUB[t.de]} />
              <stop offset="1" stopColor={COLOR_HUB[t.a]} />
            </linearGradient>
            <polyline points={rutaTroncal(t, hubs)} className="mapaV2Troncal" stroke={`url(#${id})`} />
          </g>
        );
      })}
    </g>
  );
}

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
