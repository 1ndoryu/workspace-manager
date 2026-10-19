/* Cajas isometricas 2:1 para el mapa v2.
 * [por que] Proyeccion iso PURA y valores sencillos: la celda de la cuadricula
 * tiene el MISMO tamano que la BASE de la caja (ancho x alto, relacion 2:1).
 * La caja 3D = base (rombo en el suelo, coincide con la celda) + techo (mismo
 * rombo desplazado hacia arriba) + 2 paredes. Las cajas se colocan en celdas
 * pares y dejan una celda vacia entre ellas como separacion. Asi cada rombo de
 * la rejilla es del tamano de la caja, la caja se asienta en su celda y escala sin ajustes. */

export interface PuntoIso {
  x: number;
  y: number;
}

export const TILE = {
  /* Tamano de la celda = tamano de la base de la caja. Relacion 2:1 = iso. */
  ancho: 36,
  alto: 18,
  /* Altura del techo sobre la base (hacia arriba en pantalla).
   * [por que] Mitad de la altura original (22) a peticion del usuario: cajas
   * mas bajas, menos tapadas entre filas. */
  altoPared: 11,
};

/** Centro de la celda (col, fila) en pantalla.
 * [por que] Proyeccion iso 2:1 pura: x = (col-fila)*w/2, y = (col+fila)*h/2. */
export function posicionGrid(col: number, fila: number): PuntoIso {
  return {
    x: (col - fila) * (TILE.ancho / 2),
    y: (col + fila) * (TILE.alto / 2),
  };
}

function puntosCaja(col: number, fila: number, altoPared: number = TILE.altoPared) {
  const { ancho, alto } = TILE;
  const c = posicionGrid(col, fila);
  const hw = ancho / 2;
  const hh = alto / 2;
  /* Base: rombo centrado en la celda = exactamente el rombo de la cuadricula. */
  const base = {
    top: { x: c.x, y: c.y - hh },
    right: { x: c.x + hw, y: c.y },
    bottom: { x: c.x, y: c.y + hh },
    left: { x: c.x - hw, y: c.y },
  };
  /* Techo: la misma base desplazada hacia arriba (altoPared px). */
  const techo = {
    top: { x: base.top.x, y: base.top.y - altoPared },
    right: { x: base.right.x, y: base.right.y - altoPared },
    bottom: { x: base.bottom.x, y: base.bottom.y - altoPared },
    left: { x: base.left.x, y: base.left.y - altoPared },
  };
  return { c, base, techo };
}

/** Base (rombo inferior) de la caja = celda de la cuadricula. */
export function verticesBase(col: number, fila: number): string {
  const { base } = puntosCaja(col, fila);
  return `${base.top.x},${base.top.y} ${base.right.x},${base.right.y} ${base.bottom.x},${base.bottom.y} ${base.left.x},${base.left.y}`;
}

/** Techo (rombo superior) de la caja, desplazado hacia arriba. */
export function verticesTecho(col: number, fila: number, altura?: number): string {
  const { techo } = puntosCaja(col, fila, altura);
  return `${techo.top.x},${techo.top.y} ${techo.right.x},${techo.right.y} ${techo.bottom.x},${techo.bottom.y} ${techo.left.x},${techo.left.y}`;
}

/** Pared lateral izquierda: conecta la base con el techo. */
export function verticesParedIzq(col: number, fila: number, altura?: number): string {
  const { base, techo } = puntosCaja(col, fila, altura);
  return `${base.left.x},${base.left.y} ${base.bottom.x},${base.bottom.y} ${techo.bottom.x},${techo.bottom.y} ${techo.left.x},${techo.left.y}`;
}

/** Pared lateral derecha: conecta la base con el techo. */
export function verticesParedDer(col: number, fila: number, altura?: number): string {
  const { base, techo } = puntosCaja(col, fila, altura);
  return `${base.right.x},${base.right.y} ${base.bottom.x},${base.bottom.y} ${techo.bottom.x},${techo.bottom.y} ${techo.right.x},${techo.right.y}`;
}

/** Lineas de la cuadricula iso 2:1 que separa las celdas.
 * [por que] Cada rombo de la rejilla debe medir lo mismo que la base de una
 * caja (ancho x alto) y estar centrado en la celda. Las cajas viven en celdas
 * pares (0,2,4,...); los rombos se forman con lineas que pasan por las
 * posiciones MEDIAS (0.5, 1.5, ...). El rango [minCol,maxCol]x[minFila,maxFila]
 * son las celdas de la cuadricula (indices enteros); se dibujan las lineas que
 * las delimitan, media celda mas alla para cerrar el ultimo rombo. */
export function pathCuadricula(
  minCol: number,
  maxCol: number,
  minFila: number,
  maxFila: number,
): string {
  const segmentos: string[] = [];
  // Familia A: diagonales a lo largo de cada fila (fila + 0.5).
  for (let f = minFila - 1; f <= maxFila; f++) {
    const a = posicionGrid(minCol - 0.5, f + 0.5);
    const b = posicionGrid(maxCol + 0.5, f + 0.5);
    segmentos.push(`M${a.x},${a.y} L${b.x},${b.y}`);
  }
  // Familia B: diagonales a lo largo de cada columna (col + 0.5).
  for (let c = minCol - 1; c <= maxCol; c++) {
    const a = posicionGrid(c + 0.5, minFila - 0.5);
    const b = posicionGrid(c + 0.5, maxFila + 0.5);
    segmentos.push(`M${a.x},${a.y} L${b.x},${b.y}`);
  }
  return segmentos.join(' ');
}

/* Color de cada ubicacion (espejo de las variables --mapa-* del CSS). */
export const COLOR_HUB: Record<string, string> = {
  laptop: 'var(--mapa-laptop)',
  vps89: 'var(--mapa-vps89)',
  produccion: 'var(--mapa-produccion)',
};

/** Degradado del borde de una caja, del color de cada linea que le llega.
 * Eje: arranca por el lado por donde SALE cada linea (su primer tramo, `punto`)
 * y acaba en el lado de la segunda (o en el opuesto si solo tiene una).
 * [por que] El color de cada punta coincide con la direccion real de su linea. */
export function degradadoBorde(
  col: number,
  fila: number,
  lineas: { hasta: string; punto: PuntoIso }[],
): { x1: number; y1: number; x2: number; y2: number; colores: [string, string] } | null {
  if (lineas.length === 0) return null;
  const c = posicionGrid(col, fila);
  /* Centro visual de la caja: el techo esta subido altoPared. */
  const cy = c.y - TILE.altoPared / 2;
  const direccion = (p: PuntoIso) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const n = Math.hypot(dx, dy) || 1;
    return { x: dx / n, y: dy / n };
  };
  /* Distancia desde el centro hasta el borde del rombo en esa direccion:
   * asi el color puro cae justo en la cara por donde sale la linea. */
  const alBorde = (u: PuntoIso) => 1 / (Math.abs(u.x) / (TILE.ancho / 2) + Math.abs(u.y) / (TILE.alto / 2));
  const u1 = direccion(lineas[0].punto);
  let u2 = lineas[1] ? direccion(lineas[1].punto) : { x: -u1.x, y: -u1.y };
  /* [por que] Si las dos lineas salen por la misma cara, los dos extremos del
   * degradado caen en el mismo punto y el trazo queda de un solo color: se
   * gira el segundo extremo 90 grados para que cada color ocupe su sitio. */
  if (lineas[1] && u1.x * u2.x + u1.y * u2.y > 0.98) u2 = { x: -u1.y, y: u1.x };
  const r1 = alBorde(u1);
  const r2 = alBorde(u2);
  /* Sin segunda linea, el degradado se apaga hacia el borde neutro de la caja. */
  const colores: [string, string] = [COLOR_HUB[lineas[0].hasta], lineas[1] ? COLOR_HUB[lineas[1].hasta] : 'var(--v2-borde)'];
  return { x1: c.x + u1.x * r1, y1: cy + u1.y * r1, x2: c.x + u2.x * r2, y2: cy + u2.y * r2, colores };
}



/** Puntos SVG (`x,y x,y …`) de una ruta de celdas. */
export function textoRuta(celdas: { col: number; fila: number }[]): string {
  return celdas.map(({ col, fila }) => { const p = posicionGrid(col, fila); return `${p.x},${p.y}`; }).join(' ');
}
