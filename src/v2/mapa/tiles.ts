/* Cajas isometricas 2:1 para el mapa v2.
 * [por que] Cada proyecto es una caja con 3 caras visibles: techo (diamante)
 * + pared izquierda + pared derecha. sepFila separa las filas en vertical
 * para que las paredes de una fila no se pisen con el techo de la siguiente
 * (el paso natural del grid es solo alto/2, insuficiente). */

export interface PuntoIso {
  x: number;
  y: number;
}

/* Cajas mas pequenas y con aire entre ellas: ancho/alto reducidos y
 * separacion extra tanto en filas (sepFila) como en columnas (sepCol), para
 * que el mapa no se vea apretado. */
export const TILE = {
  ancho: 22,
  alto: 11,
  altoPared: 14,
  sepFila: 36,
  sepCol: 26,
};

/** Centro del techo (diamante) del tile en pantalla.
 * [por que] Cada fila suma sepFila extra en vertical y cada columna sepCol
 * en horizontal: asi las cajas quedan separadas sin solaparse las paredes. */
export function posicionGrid(col: number, fila: number): PuntoIso {
  const { ancho, alto, sepFila, sepCol } = TILE;
  return {
    x: (col - fila) * (ancho / 2 + sepCol),
    y: (col + fila) * (alto / 2) + fila * sepFila,
  };
}

function puntosCaja(col: number, fila: number) {
  const { ancho, alto, altoPared } = TILE;
  const c = posicionGrid(col, fila);
  const hw = ancho / 2;
  const hh = alto / 2;
  return {
    c,
    top: { x: c.x, y: c.y - hh },
    right: { x: c.x + hw, y: c.y },
    bottom: { x: c.x, y: c.y + hh },
    left: { x: c.x - hw, y: c.y },
    altoPared,
  };
}

/** Techo (diamante superior) de la caja. */
export function verticesTecho(col: number, fila: number): string {
  const { top, right, bottom, left } = puntosCaja(col, fila);
  return `${top.x},${top.y} ${right.x},${right.y} ${bottom.x},${bottom.y} ${left.x},${left.y}`;
}

/** Pared lateral izquierda (paralelogramo vertical). */
export function verticesParedIzq(col: number, fila: number): string {
  const { left, bottom, altoPared } = puntosCaja(col, fila);
  return `${left.x},${left.y} ${bottom.x},${bottom.y} ${bottom.x},${bottom.y + altoPared} ${left.x},${left.y + altoPared}`;
}

/** Pared lateral derecha (paralelogramo vertical). */
export function verticesParedDer(col: number, fila: number): string {
  const { right, bottom, altoPared } = puntosCaja(col, fila);
  return `${right.x},${right.y} ${bottom.x},${bottom.y} ${bottom.x},${bottom.y + altoPared} ${right.x},${right.y + altoPared}`;
}
