/* Persistencia de la bandera `permanente` en la ficha del registro.
 * [por que] Vive aqui y no en dev.mjs porque el que la escribe es el `up` remoto: en un proyecto
 * local la bandera no rearma nada y aceptarla seria prometer un tramo que no existe. */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';

import { esPermanente } from '../doctor.mjs';

/* Deja la entrada `id` en `permanente: valor`. Devuelve { ok, sinCambio?, resumen? }.
 * [por que] tmp + rename: el registro lo leen el doctor y el tablero a la vez, y un truncado a
 * medias los dejaria sin ficha (mismo patron que scripts/dev/taller/publicar-host.mjs).
 * [por que] Al escribir se borra el alias `supervisar`: dos claves para lo mismo son dos verdades
 * y la siguiente lectura no sabria cual manda. */
export function persistirPermanente(ruta, id, valor) {
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    return { ok: false, resumen: `registro no legible (${e.message})` };
  }
  const entrada = (crudo?.proyectos ?? []).find((p) => p?.id === id);
  if (!entrada) return { ok: false, resumen: `sin entrada '${id}' en el registro` };
  const sinCambio = esPermanente(entrada) === valor && entrada.supervisar === undefined;
  if (!sinCambio) {
    entrada.permanente = valor;
    delete entrada.supervisar;
    const tmp = `${ruta}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(crudo, null, 2)}\n`);
    renameSync(tmp, ruta);
  }
  return { ok: true, sinCambio };
}

/* Valor que piden los argv, o undefined si no dicen nada. Los dos a la vez son un error del
 * llamador: se queda con el ultimo, que es lo que hace cualquier opcion repetida. */
export function valorPermanente(args) {
  if (args.includes('--no-permanente')) return false;
  return args.includes('--permanente') ? true : undefined;
}
