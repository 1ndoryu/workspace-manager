/* Proyeccion isometrica 2:1 para el mapa.
 * [por que] Sin libreria: convertir coordenadas de grid (x,y,z) a pantalla
 * con transformacion isometrica pura, testeable y sin dependencias. */

export interface PuntoIso {
  x: number;
  y: number;
}

/** Convierte grid (x,y,z) a coordenadas de pantalla con angulo isometrico 2:1. */
export function iso(x: number, y: number, z: number, ancho: number, alto: number): PuntoIso {
  const px = (x - y) * ancho;
  const py = ((x + y) * alto) / 2 - z;
  return { x: px, y: py };
}

/** Tamaño de tile isometrico (diamante). */
export const TILE = { ancho: 48, alto: 24, altoPared: 40 };

/** Genera los vertices de un tile isometrico (diamante) en pantalla. */
export function verticesTile(x: number, y: number, z: number): string {
  const { ancho, alto } = TILE;
  const p = iso(x, y, z, ancho, alto);
  const hw = ancho / 2;
  const hh = alto / 2;
  return [
    `${p.x},${p.y - hh}`,
    `${p.x + hw},${p.y}`,
    `${p.x},${p.y + hh}`,
    `${p.x - hw},${p.y}`,
  ].join(' ');
}

/** Genera los vertices de la pared frontal de un tile (efecto volumen 3D). */
export function verticesPared(x: number, y: number, z: number): string {
  const { ancho, alto, altoPared } = TILE;
  const p = iso(x, y, z, ancho, alto);
  const hw = ancho / 2;
  const hh = alto / 2;
  return [
    `${p.x - hw},${p.y}`,
    `${p.x},${p.y + hh}`,
    `${p.x},${p.y + hh + altoPared}`,
    `${p.x - hw},${p.y + altoPared}`,
  ].join(' ');
}
