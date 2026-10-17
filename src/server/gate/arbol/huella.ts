/* Huella del árbol de trabajo de un proyecto (13AA-3).
 * [por que] La caché del tablero se invalida por HEAD, así que no ve cambios sin
 * commitear y el gate tenía que forzar un análisis completo (~60 s) en cada
 * llamada. La huella = frescura (versiones de las herramientas) + HEAD leído de
 * git en el momento (el snapshot en memoria puede ir por detrás) + los archivos
 * cambiados frente a HEAD (tamaño y mtime) + los sin seguimiento.
 * Mismo árbol, misma huella: el gate reutiliza el análisis en vez de repetirlo.
 * Límite conocido: no ve archivos ignorados por git (sentinel tampoco los analiza)
 * ni el contenido interno de submódulos (cuentan por la entrada del directorio). */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BIN_GIT } from '../../../shared/binarios.js';

const execFileAsync = promisify(execFile);

/* Con más cambios que esto, un análisis nuevo sale más barato que fiarse de la
 * huella: se devuelve null y el gate recalcula. */
const TOPE_ARCHIVOS = 5000;

async function listaGit(ruta: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync(BIN_GIT, ['-C', ruta, ...args, '-z'], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.split('\0').filter((x) => x !== '');
}

function firmaArchivo(ruta: string, rel: string): string {
  try {
    const s = statSync(join(ruta, rel));
    return `${rel}:${s.size}:${Math.trunc(s.mtimeMs)}`;
  } catch {
    return `${rel}:borrado`;
  }
}

/* null = no se puede fiar de la huella (git falló o demasiados cambios): el
 * llamador analiza sin caché. Nunca lanza. */
export async function huellaArbol(ruta: string, fresco: string): Promise<string | null> {
  try {
    /* allSettled y no all: si una falla, la otra sigue viva con el cwd dentro de
     * la carpeta y en Windows bloquearía su borrado. */
    const [rCambiados, rNuevos, rHead] = await Promise.allSettled([
      listaGit(ruta, ['diff', '--name-only', 'HEAD']),
      listaGit(ruta, ['ls-files', '--others', '--exclude-standard']),
      listaGit(ruta, ['rev-parse', 'HEAD']),
    ]);
    if (rCambiados.status === 'rejected' || rNuevos.status === 'rejected' || rHead.status === 'rejected') return null;
    const cambiados = rCambiados.value;
    const nuevos = rNuevos.value;
    const todos = [...new Set([...cambiados, ...nuevos])].sort();
    if (todos.length > TOPE_ARCHIVOS) return null;
    const h = createHash('sha1');
    h.update(fresco);
    h.update(`
HEAD:${rHead.value.join('')}`);
    for (const rel of todos) h.update(`\n${firmaArchivo(ruta, rel)}`);
    return h.digest('hex');
  } catch {
    return null;
  }
}
