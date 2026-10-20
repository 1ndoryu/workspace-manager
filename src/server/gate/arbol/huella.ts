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
import { BIN_GIT } from '../../plataforma/sistema/binarios.js';

const execFileAsync = promisify(execFile);

/* Con más cambios que esto, un análisis nuevo sale más barato que fiarse de la
 * huella: se devuelve null y el gate recalcula. */
const TOPE_ARCHIVOS = 5000;

async function git(ruta: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(BIN_GIT, ['-C', ruta, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/* [por que] `-z` solo vale para listas (diff, ls-files). Con rev-parse git lo imprime
 * como un argumento más y el HEAD salía como «<hash>\n-z\n». */
async function listaGit(ruta: string, args: string[]): Promise<string[]> {
  return (await git(ruta, [...args, '-z'])).split('\0').filter((x) => x !== '');
}

function firmaArchivo(ruta: string, rel: string): string {
  try {
    const s = statSync(join(ruta, rel));
    return `${rel}:${s.size}:${Math.trunc(s.mtimeMs)}`;
  } catch {
    return `${rel}:borrado`;
  }
}

/* [por que] Una sola fórmula para la huella: la usan el análisis (con cambios) y el
 * tablero (sin cambios, sin tocar git). Si divergieran, el caché limpio nunca casaría. */
function combinar(fresco: string, head: string, firmas: string[]): string {
  const h = createHash('sha1');
  h.update(fresco);
  h.update(`\nHEAD:${head}`);
  for (const f of firmas) h.update(`\n${f}`);
  return h.digest('hex');
}

/* Huella de un árbol sin cambios (HEAD limpio). Es la que tendría huellaArbol: permite
 * a las rutas síncronas comparar con lo guardado sin lanzar git. */
export function huellaSinCambios(fresco: string, head: string): string {
  return combinar(fresco, head, []);
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
      git(ruta, ['rev-parse', 'HEAD']),
    ]);
    if (rCambiados.status === 'rejected' || rNuevos.status === 'rejected' || rHead.status === 'rejected') return null;
    const cambiados = rCambiados.value;
    const nuevos = rNuevos.value;
    const todos = [...new Set([...cambiados, ...nuevos])].sort();
    if (todos.length > TOPE_ARCHIVOS) return null;
    /* trim: rev-parse termina en salto de línea, que no es parte del HEAD. */
    return combinar(fresco, rHead.value.trim(), todos.map((rel) => firmaArchivo(ruta, rel)));
  } catch {
    return null;
  }
}
