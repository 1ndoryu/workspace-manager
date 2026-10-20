/* Geometría del viewBox del mapa v2. [por que] Funciones puras: el centro base se calcula
 * una vez y el zoom y el pan solo lo escalan y desplazan. */
import { TILE } from '../geometria/tiles.js';
import type { RangoCeldas } from './escena.js';

/* Cuadrícula extendida EXT celdas más allá del contenido en cada dirección. [por que] La
 * extensión es simétrica: el centro de la cuadrícula coincide con el centro de las cajas. */
export const EXT = 6;

/* Los nodos de ubicación son cajas más altas que las de proyecto: se leen como "plataformas". */
export const ALTO_HUB = TILE.altoPared * 2;

export interface BaseMapa {
  cx: number;
  cy: number;
  anchoBase: number;
  altoBase: number;
}

/* viewBox base (zoom 1, sin pan): bbox de la cuadrícula extendida + margen. Separado del final
 * porque el arrastre solo necesita el centro base para desplazarlo. */
export function calcularBase(rango: RangoCeldas | null): BaseMapa | null {
  if (!rango) return null;
  const margen = 80;
  const w = TILE.ancho / 2;
  const h = TILE.alto / 2;
  const { minCol, maxCol, minFila, maxFila } = rango;
  // Lineas de rejilla en offsets 0.5; esquinas del rombo extremo.
  const minX = (minCol - EXT - 0.5 - (maxFila + EXT + 0.5)) * w;
  const maxX = (maxCol + EXT + 0.5 - (minFila - EXT - 0.5)) * w;
  const minY = (minCol - EXT - 0.5 + minFila - EXT - 0.5) * h;
  const maxY = (maxCol + EXT + 0.5 + maxFila + EXT + 0.5) * h;
  const anchoBase = maxX - minX + margen * 2;
  const altoBase = maxY - minY + margen * 2;
  return {
    cx: minX - margen + anchoBase / 2,
    cy: minY - margen + altoBase / 2,
    anchoBase,
    altoBase,
  };
}

/* viewBox final: el centro se desplaza por el pan y se escala por el zoom alrededor del centro
 * (no de la esquina) para mantener el mapa centrado al acercar o alejar. */
export function calcularViewBox(base: BaseMapa | null, zoom: number, pan: { x: number; y: number }): string {
  if (!base) return '0 0 100 100';
  const ancho = base.anchoBase / zoom;
  const alto = base.altoBase / zoom;
  const cx = base.cx + pan.x;
  const cy = base.cy + pan.y;
  return `${cx - ancho / 2} ${cy - alto / 2} ${ancho} ${alto}`;
}
