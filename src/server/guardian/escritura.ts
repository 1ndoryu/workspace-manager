/* Lectura y escritura seguras de ficheros de configuración de proyecto (F11.4).
 * [por que] La pestaña Guardián edita sentinel.config.json y lote-extra.md de
 * cualquier proyecto: no debe seguir symlinks, no debe truncar el fichero si
 * la escritura falla a medias y no debe pisar una edición ajena hecha entre la
 * lectura y el guardado (concurrencia optimista con hash). */
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export type Eol = '\r\n' | '\n';

export type LecturaFichero =
  | { estado: 'ausente' }
  | { estado: 'invalido'; motivo: string }
  | { estado: 'ok'; contenido: string; eol: Eol; hash: string };

export function hashDe(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function eolDe(texto: string): Eol {
  return texto.includes('\r\n') ? '\r\n' : '\n';
}

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

/* Diferencia por bloque: recorta el prefijo y el sufijo comunes. Basta para
 * mostrar un cambio de JSON (pocas líneas cambian) sin dependencia de diff. */
export interface BloqueDiff {
  /* Línea de inicio (1-based) del bloque en el texto original. */
  desde: number;
  quitar: string[];
  poner: string[];
}

export function diffLineas(antes: string, despues: string): BloqueDiff | null {
  const a = antes.split(/\r?\n/u);
  const b = despues.split(/\r?\n/u);
  let prefijo = 0;
  while (prefijo < a.length && prefijo < b.length && a[prefijo] === b[prefijo]) prefijo++;
  let sufijo = 0;
  while (
    sufijo < a.length - prefijo &&
    sufijo < b.length - prefijo &&
    a[a.length - 1 - sufijo] === b[b.length - 1 - sufijo]
  ) sufijo++;
  const quitar = a.slice(prefijo, a.length - sufijo);
  const poner = b.slice(prefijo, b.length - sufijo);
  if (quitar.length === 0 && poner.length === 0) return null;
  return { desde: prefijo + 1, quitar, poner };
}
