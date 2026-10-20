/* Lectura y escritura seguras de ficheros de configuración de proyecto (F11.4).
 * [por que] La pestaña Guardián edita sentinel.config.json y lote-extra.md de
 * cualquier proyecto: no debe seguir symlinks, no debe truncar el fichero si
 * la escritura falla a medias y no debe pisar una edición ajena hecha entre la
 * lectura y el guardado (concurrencia optimista con hash). [19AA-13] La parte pura
 * (hash, EOL, diferencia por bloque) vive en escritura/puro.ts y se reexporta aquí. */
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { eolDe, hashDe, type Eol } from './escritura/puro.js';

export { diffLineas, eolDe, hashDe } from './escritura/puro.js';
export type { BloqueDiff, Eol } from './escritura/puro.js';

export type LecturaFichero =
  | { estado: 'ausente' }
  | { estado: 'invalido'; motivo: string }
  | { estado: 'ok'; contenido: string; eol: Eol; hash: string };

/* Lee un fichero regular. [por que] lstat antes de leer: un symlink dentro de
 * un proyecto podría apuntar fuera del área y el tablero lo editaría. */
export function leerFichero(ruta: string): LecturaFichero {
  let meta;
  try {
    meta = lstatSync(ruta);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { estado: 'ausente' };
    return { estado: 'invalido', motivo: 'no se puede acceder al fichero' };
  }
  if (meta.isSymbolicLink() || !meta.isFile()) {
    return { estado: 'invalido', motivo: 'no es un fichero regular (symlink o carpeta)' };
  }
  const contenido = readFileSync(ruta, 'utf8');
  return { estado: 'ok', contenido, eol: eolDe(contenido), hash: hashDe(contenido) };
}

/* Reemplazo atómico: escribe a un temporal del mismo directorio y renombra.
 * [por que] Si el proceso muere a mitad, el fichero original sigue intacto. */
export function escribirAtomico(ruta: string, contenido: string): void {
  const temporal = `${ruta}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporal, contenido, 'utf8');
  try {
    renameSync(temporal, ruta);
  } catch (err) {
    try {
      unlinkSync(temporal);
    } catch {
      /* el temporal quedó huérfano: no es fatal */
    }
    throw err;
  }
}
