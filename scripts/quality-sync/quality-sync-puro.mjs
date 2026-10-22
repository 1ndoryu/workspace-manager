/* Reglas PURAS de quality:sync (sin disco, git ni consola): normalizan rutas y commits
 * y deciden si un checkout es el compartido. */

import { join } from 'node:path';
import { RAIZ_AREA } from '../shared/rutas.mjs';

/* Checkout compartido del gate (carpeta fija del area, sin leer disco). */
export const CHECKOUT = join(RAIZ_AREA, '.quality-tools');

/* Herramientas del checkout compartido y su subcarpeta. */
export const HERRAMIENTAS = {
  sentinel: 'sentinel',
  varsense: 'varsense',
};
/* Cabecera del archivo de manifest del consumidor. [por que] `quality-tools.json`
 * es el contrato del gate por consumidor; el `commit` de cada tool es lo que este
 * script compara contra el HEAD del checkout compartido. */
export const QITOOLS = 'quality-tools.json';
/* Normaliza una ruta absoluta a una comparacion portable (lowercase en
 * Windows; el server corre en Windows). */
function keyRuta(p) {
  if (!p) return p;
  return p.replace(/\//g, '\\').replace(/\\\\+/g, '\\').toLowerCase();
}

/* True si el consumidor senala el checkout compartido (sourcePathEnv declarado
 * para la herramienta, o sourcePath que resuelve dentro de .quality-tools). */
export function esCompartido(relPath, tool) {
  const base = keyRuta(CHECKOUT);
  const destacada = keyRuta(join(CHECKOUT, tool));
  const r = keyRuta(relPath);
  if (!r) return false;
  // mayusculas de driveletter/lowercase: keyRuta ya bajo
  return r.includes(destacada) || r === base || r.includes(base + '\\');
}
/* Normaliza el commit a forma corta (primeros 12 chars) para comparar igual que
 * el checkout compartido y los archivos del area (muchos usan hash corto). */
export function corto(h) {
  if (!h || typeof h !== 'string') return h;
  return h.toLowerCase().slice(0, 12);
}
