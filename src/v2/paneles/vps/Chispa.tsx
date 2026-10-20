/* Minigráfico SVG del panel de recursos de la VPS (partido de PanelVpsRecursos.tsx): una o dos
 * series dibujadas a mano, sin librerías. Sin estado ni IO: solo pinta lo que recibe. */

/* Minigráfico: una o dos series normalizadas al máximo. */
export function Chispa({ series, alto = 36 }: { series: number[][]; alto?: number }) {
  const plano = series.flat();
  const max = Math.max(1, ...plano);
  const n = Math.max(...series.map((s) => s.length), 1);
  const W = 120;
  const H = alto;
  const puntos = (s: number[]) =>
    s
      .map(
        (v, i) =>
          `${((i / Math.max(n - 1, 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`,
      )
      .join(' ');
  return (
    <svg
      className="vpsChispa"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* El orden de las series es fijo (serie 1 sólida, serie 2
        * punteada): la clave deriva del contenido, nunca del índice. */}
      {series.map((s) => (
        <polyline
          key={puntos(s)}
          points={puntos(s)}
          fill="none"
          stroke="currentColor"
          strokeWidth={s === series[0] ? 1.5 : 1}
          strokeDasharray={s === series[0] ? undefined : '3 2'}
        />
      ))}
    </svg>
  );
}
