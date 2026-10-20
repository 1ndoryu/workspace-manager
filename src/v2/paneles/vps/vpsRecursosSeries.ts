/* Series del panel de recursos de la VPS (partido de PanelVpsRecursos.tsx): tipo de muestra,
 * rangos del historial y las velocidades y el diezmado que los pintan. [por que] Funciones puras,
 * sin localStorage ni DOM: se prueban a pelo y el detalle por sitio reutiliza los mismos rangos. */

/* Muestra como tupla [t, cpu, mem, rx, tx, br, bw, dr, dw]: compacta en
 * el localStorage (≈60 caracteres por muestra). dr/dw = IO del host en
 * bytes (sectores de pulse × 512); br/bw por contenedor se guardan pero
 * ya no se pintan (cgroup v2 los devuelve a cero). */
export type Muestra = [number, number, number, number, number, number, number, number, number];

const MAX_PUNTOS = 240;

/* [0110A-3 F2] Reutilizados por el detalle por sitio (misma chispa y
 * mismos rangos que el panel global, sin variante local). */
export const RANGOS = [
  { id: '30m', etiqueta: '30 min', ms: 30 * 60 * 1000 },
  { id: '1h', etiqueta: '1 h', ms: 3600 * 1000 },
  { id: '4h', etiqueta: '4 h', ms: 4 * 3600 * 1000 },
  { id: '1d', etiqueta: '1 día', ms: 24 * 3600 * 1000 },
  { id: '1sem', etiqueta: '1 semana', ms: 7 * 24 * 3600 * 1000 },
] as const;

/* Velocidades por segundo entre muestras consecutivas (contadores que se
 * reinician —p. ej. reinicio del host— sujetan a cero, nunca negativas).
 * Vale con muestras separadas (el dt normaliza), así que sirve sobre la
 * serie diezmada del rango. */
export function ritmos(m: Muestra[]): {
  rx: number[];
  tx: number[];
  br: number[];
  bw: number[];
  dr: number[];
  dw: number[];
} {
  const rx: number[] = [];
  const tx: number[] = [];
  const br: number[] = [];
  const bw: number[] = [];
  const dr: number[] = [];
  const dw: number[] = [];
  for (let i = 1; i < m.length; i++) {
    const dt = Math.max(1, (m[i][0] - m[i - 1][0]) / 1000);
    rx.push(Math.max(0, (m[i][3] - m[i - 1][3]) / dt));
    tx.push(Math.max(0, (m[i][4] - m[i - 1][4]) / dt));
    br.push(Math.max(0, (m[i][5] - m[i - 1][5]) / dt));
    bw.push(Math.max(0, (m[i][6] - m[i - 1][6]) / dt));
    dr.push(Math.max(0, (m[i][7] - m[i - 1][7]) / dt));
    dw.push(Math.max(0, (m[i][8] - m[i - 1][8]) / dt));
  }
  return { rx, tx, br, bw, dr, dw };
}

/* Diezmado por paso para no pintar más de MAX_PUNTOS (el dt de `ritmos`
 * absorbe el hueco: la velocidad sigue siendo válida). */
export function diezmar(m: Muestra[]): Muestra[] {
  if (m.length <= MAX_PUNTOS) return m;
  const paso = Math.ceil(m.length / MAX_PUNTOS);
  const fuera: Muestra[] = [];
  for (let i = 0; i < m.length; i += paso) fuera.push(m[i]);
  const ultima = m[m.length - 1];
  if (fuera[fuera.length - 1] !== ultima) fuera.push(ultima);
  return fuera;
}
