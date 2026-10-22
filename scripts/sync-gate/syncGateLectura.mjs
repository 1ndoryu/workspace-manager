/* Lectura E/S del config.d.ts del runtime: lo lee del disco y lo parsea con las funciones
 * puras de syncGateParseo.mjs. */

import { readFileSync } from 'node:fs';
import { extraerInterface, formaDts, limpiarComentarios, parsearObjeto } from './syncGateParseo.mjs';

export function leerEsquemaRuntime(dtsPath, nombre) {
  const texto = limpiarComentarios(readFileSync(dtsPath, 'utf8'));
  const rango = extraerInterface(texto, nombre);
  if (!rango) return null;
  const cuerpo = texto.slice(rango.ini + 1, rango.fin);
  return parsearObjeto(cuerpo, formaDts).hijos;
}
