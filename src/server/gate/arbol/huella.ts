/* Huella del árbol de trabajo de un proyecto (13AA-3).
 * [por que] La caché del tablero se invalida por HEAD, así que no ve cambios sin
 * commitear y el gate tenía que forzar un análisis completo (~60 s) en cada
 * llamada. La huella = frescura (versiones de las herramientas) + HEAD leído de
 * git en el momento (el snapshot en memoria puede ir por detrás) + los archivos
 * cambiados frente a HEAD (tamaño y mtime) + los sin seguimiento.
 * Mismo árbol, misma huella: el gate reutiliza el análisis en vez de repetirlo.
 * Límite conocido: no ve archivos ignorados por git (sentinel tampoco los analiza)
 * ni el contenido interno de submódulos (cuentan por la entrada del directorio). */
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { PUERTO_GIT, type PuertoGit } from '../../scanner/git.js';

/* Con más cambios que esto, un análisis nuevo sale más barato que fiarse de la
 * huella: se devuelve null y el gate recalcula. */
const TOPE_ARCHIVOS = 5000;

/* [por que] `-z` solo vale para listas (diff, ls-files). Con rev-parse git lo imprime
 * como un argumento más y el HEAD salía como «<hash>\n-z\n». */
function listaGit(salida: string): string[] {
  return salida.split('\0').filter((x) => x !== '');
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
export async function huellaArbol(ruta: string, fresco: string, puerto: PuertoGit = PUERTO_GIT): Promise<string | null> {
  try {
    /* [por que] Los tres git a la vez: la huella se calcula en cada apertura del
     * tablero. El puerto no lanza, devuelve null cuando git falla; null aquí significa
     * que no hay huella fiable y el llamador analiza sin caché. */
    const [cambiados, nuevos, head] = await Promise.all([
      puerto.gitAsync(ruta, ['diff', '--name-only', 'HEAD', '-z']),
      puerto.gitAsync(ruta, ['ls-files', '--others', '--exclude-standard', '-z']),
      puerto.gitAsync(ruta, ['rev-parse', 'HEAD']),
    ]);
    if (cambiados === null || nuevos === null || head === null) return null;
    const todos = [...new Set([...listaGit(cambiados), ...listaGit(nuevos)])].sort();
    if (todos.length > TOPE_ARCHIVOS) return null;
    /* trim: rev-parse termina en salto de línea, que no es parte del HEAD. */
    return combinar(fresco, head.trim(), todos.map((rel) => firmaArchivo(ruta, rel)));
  } catch {
    return null;
  }
}
