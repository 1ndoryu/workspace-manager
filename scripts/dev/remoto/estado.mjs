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

// PID del tunel solo si sigue siendo el que abrimos (creationTime exacta) y su linea de comando es la nuestra.

export function marcaTiempo() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

// Conteos "tabla=valor" de `psql -At`. Pura: se prueba sin base.
