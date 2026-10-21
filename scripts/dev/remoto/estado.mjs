/* Estado en disco del taller remoto: PID del tunel y marca de tiempo. */

import { RAIZ_REPO } from '../doctor.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DIR_LOGS = join(RAIZ_REPO, 'logs');

export const rutaEstado = (id) => join(DIR_LOGS, `remoto-${id}.json`);
// slugSesion: mismo saneado que la sesión de Mutagen (rcargo.mjs), para que el id con espacio no rompa el nombre.

export function leerEstado(id) {
  try {
    return JSON.parse(readFileSync(rutaEstado(id), 'utf8'));
  } catch {
    return null;
  }
}


export function escribirEstado(id, estado) {
  mkdirSync(DIR_LOGS, { recursive: true });
  writeFileSync(rutaEstado(id), `${JSON.stringify(estado, null, 2)}\n`);
}

/* Registro del túnel que sostiene el PORTÁTIL para esta entrada (protocolo de estado permanente,
 * 2026-10-21). Es aparte del estado del `up` a propósito: el supervisor del tablero reabre solo
 * este tramo y no debe pisar lo que un `up`/`stop` dejó dicho sobre los puertos del proyecto. */
export const rutaEstadoTunel = (id) => join(DIR_LOGS, `remoto-tunel-${id}.json`);

export function leerEstadoTunel(id) {
  try {
    return JSON.parse(readFileSync(rutaEstadoTunel(id), 'utf8'));
  } catch {
    return null;
  }
}

export function escribirEstadoTunel(id, estado) {
  mkdirSync(DIR_LOGS, { recursive: true });
  writeFileSync(rutaEstadoTunel(id), `${JSON.stringify(estado, null, 2)}\n`);
}

// PID del tunel solo si sigue siendo el que abrimos (creationTime exacta) y su linea de comando es la nuestra.

export function marcaTiempo() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

// Conteos "tabla=valor" de `psql -At`. Pura: se prueba sin base.
