/* Cajas isometricas wireframe 2:1 para el mapa v2.
 * [por que] Proyeccion isometrica PURA: el espaciado del grid va en la celda
 * (celdaAncho/celdaAlto con relacion 2:1) y la caja se dibuja mas pequena,
 * centrada en la celda. Asi las diagonales se alinean correctamente y las
 * cajas quedan separadas SIN romper la perspectiva (el fallo anterior era
 * meter la separacion dentro del paso diagonal). */

export interface PuntoIso {
  x: number;
  y: number;
}

export const TILE = {
  /* Celda del grid: define el espaciado. Relacion 2:1 = perspectiva iso. */
  celdaAncho: 64,
  celdaAlto: 32,
  /* Tamano de la caja dibujada dentro de la celda (mas pequena que la celda
   * para que queden separadas). */
  ancho: 36,
  alto: 18,
  altoPared: 22,
};

/** Centro de la celda (col, fila) en pantalla.
 * [por que] Proyeccion iso 2:1 pura: x = (col-fila)*w/2, y = (col+fila)*h/2.
 * No se anade separacion dentro del paso: eso rompia la perspectiva. */
export function posicionGrid(col: number, fila: number): PuntoIso {
  return {
    x: (col - fila) * (TILE.celdaAncho / 2),
    y: (col + fila) * (TILE.celdaAlto / 2),
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

/** Lineas de la cuadricula iso 2:1 que separa las celdas.
 * [por que] Las cajas estan centradas en posiciones enteras (col, fila); la
 * rejilla debe pasar ENTRE ellas, en los puntos medios (offsets de 0.5), para
 * formar rombos con cada caja centrada dentro. Dos familias de diagonales
 * (pendiente +0.5 y -0.5 en pantalla) forman la rejilla. */
export function pathCuadricula(maxCol: number, maxFila: number): string {
  const segmentos: string[] = [];
  // Familia A: diagonales entre filas (fila + 0.5), de borde a borde.
  for (let f = -1; f <= maxFila; f++) {
    const a = posicionGrid(-0.5, f + 0.5);
    const b = posicionGrid(maxCol + 0.5, f + 0.5);
    segmentos.push(`M${a.x},${a.y} L${b.x},${b.y}`);
  }
  // Familia B: diagonales entre columnas (col + 0.5), de borde a borde.
  for (let c = -1; c <= maxCol; c++) {
    const a = posicionGrid(c + 0.5, -0.5);
    const b = posicionGrid(c + 0.5, maxFila + 0.5);
    segmentos.push(`M${a.x},${a.y} L${b.x},${b.y}`);
  }
  return segmentos.join(' ');
}
