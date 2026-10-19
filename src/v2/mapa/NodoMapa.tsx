/* Nodo de ubicación (laptop, VPS 89, producción): caja alta (la etiqueta va en la capa final del mapa). */
import { rutaTroncal, type Hub, type Troncal } from './geometria/disposicion.js';
import { COLOR_HUB, posicionGrid, verticesParedDer, verticesParedIzq, verticesTecho } from './geometria/tiles.js';

/* Enlaces entre nodos, pegados al suelo: degradado del color de un nodo al del otro.
 * [por que] Userspace: el degradado va de centro a centro de los nodos, no de la caja del trazo. */
/* Línea con puntos que viajan por ella (flujo de datos): la base lleva el color y
 * la capa `mapaV2Flujo` anima solo el desplazamiento del trazo discontinuo. */
export function EnlaceSuelo({ puntos, hasta, vivo, atenuar }: { puntos: string; hasta: string; vivo: boolean; atenuar: boolean }) {
  return (
    <g className={`mapaV2Enlaces${atenuar ? ' mapaV2Enlace--ajeno' : ''}`}>
      <polyline points={puntos} className={`mapaV2Enlace mapaV2Enlace--${hasta}`} filter={vivo ? 'url(#mapaV2Brillo)' : undefined} />
      <polyline points={puntos} className="mapaV2Flujo" />
    </g>
  );
}

export function Troncales({ troncales, hubs, atenuar }: { troncales: Troncal[]; hubs: Hub[]; atenuar: boolean }) {
  return (
    <g className={`mapaV2Enlaces${atenuar ? ' mapaV2Enlace--ajeno' : ''}`}>
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
            <polyline points={rutaTroncal(t, hubs)} className="mapaV2Flujo" />
          </g>
        );
      })}
    </g>
  );
}

/* [por que] El raton entra por el techo: avisa al mapa para mostrar el nombre del nodo. */
export function NodoMapa({ h, alto, onSobre }: { h: Hub; alto: number; onSobre: (id: string | null) => void }) {
  return (
    <g className={`mapaV2Hub mapaV2Hub--${h.id}`} onMouseEnter={() => onSobre(h.id)} onMouseLeave={() => onSobre(null)}>
      <title>{`${h.etiqueta}: ${h.total} enlaces`}</title>
      <polygon points={verticesParedDer(h.col, h.fila, alto)} className="mapaV2HubPared" />
      <polygon points={verticesParedIzq(h.col, h.fila, alto)} className="mapaV2HubPared" />
      <polygon points={verticesTecho(h.col, h.fila, alto)} className="mapaV2HubTecho" />
    </g>
  );
}
