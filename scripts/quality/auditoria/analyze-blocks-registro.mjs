/* Lectura de configuración para analyze-blocks (E/S: disco). Separada del CLI y de las
 * reglas puras para que cada pieza tenga una sola responsabilidad. */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ_REPO, rutaConfigPrivada } from '../../shared/rutas.mjs';

/* Registro de excepciones verificadas. [por que] Es configuracion nuestra (que
 * hallazgos ya aceptamos y por que), no del producto: vive en la config privada
 * y sin ella el veredicto sale sin cobertura, que es un resultado valido. */
const EXCEPCIONES = rutaConfigPrivada('quality-excepciones.json');

/* Mapa id → ruta absoluta del repo, derivado del registro privado.
 * [por que] Antes era una lista de proyectos incrustada en el código: ataba el
 * script al área de una máquina concreta. El registro ya declara `id` y `ruta`
 * de cada proyecto (`ruta` es relativa a RAIZ_REPO), así que aquí solo se
 * resuelve. */
export function reposDelRegistro() {
  const reg = JSON.parse(readFileSync(rutaConfigPrivada('registro.json'), 'utf8'));
  return new Map(reg.proyectos.map((p) => [p.id, resolve(RAIZ_REPO, p.ruta)]));
}

/* Devuelve el registro de excepciones o `{ proyectos: [] }` si no existe o no parsea
 * (sin cobertura, veredicto válido). */
export function leerExcepciones() {
  let registro = { proyectos: [] };
  if (existsSync(EXCEPCIONES)) {
    try {
      registro = JSON.parse(readFileSync(EXCEPCIONES, 'utf8'));
    } catch {
      console.warn(`${EXCEPCIONES} no parsea — veredicto sin cobertura`);
    }
  }
  return registro;
}
