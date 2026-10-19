/* Borde animado de una caja en modo dev: un trazo claro discontinuo que recorre sus caras.
 * [por que] Va encima del borde solido, que sigue visible entre tramos. Sin eventos de raton. */
export function BordeDev({ caras }: { caras: string[] }) {
  return (
    <g className="mapaV2BordeDev">
      {caras.map((puntos) => (
        <polygon key={puntos} points={puntos} />
      ))}
    </g>
  );
}
