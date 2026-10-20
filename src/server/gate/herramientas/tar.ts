/* Localiza el `tar` que empaqueta el árbol enviado a la 89. [por que] Vive aparte del
 * audit: es una búsqueda de binario, no una decisión de auditoría. El entorno (WS_TAR y
 * PATH) llega por parámetro, así que las pruebas no tocan el proceso. */
import { statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { BIN_TAR } from '../../plataforma/sistema/binarios.js';

export type EntornoTar = Partial<Pick<NodeJS.ProcessEnv, 'WS_TAR' | 'PATH'>>;

/* `tar` del PATH puede ser el de Windows (bsdtar) según cómo arranque el padre; el de
 * Git es el que se ha probado. Se resuelve por ruta, no por orden.
 * [por que] Antes eran dos rutas fijas de `C:\Program Files\Git`: la instalación por
 * defecto de una máquina, no una verdad del proyecto. La raíz se deriva ahora del `git`
 * que haya en el PATH; `WS_TAR` la fija a mano. */
export function tarReal(entorno: EntornoTar = process.env): string {
  const declarado = entorno.WS_TAR?.trim();
  if (declarado) return declarado;
  for (const c of candidatosTar(raizDeGit(entorno.PATH ?? ''))) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* siguiente candidato */
    }
  }
  return BIN_TAR;
}

/* Candidatos a `tar` de Git, derivados de dónde está el `git` del PATH.
 * [por que] No hay una sola forma: según la instalación, el ejecutable aparece en
 * `<raiz>\cmd`, `<raiz>\bin` o `<raiz>\mingw64\bin`, y el `tar` de Git vive en
 * `<raiz>\usr\bin`. Se suben hasta tres niveles probando las ubicaciones en cada uno.
 * En Linux no casa ninguna y se cae a `tar`, que allí ya es GNU tar. */
function candidatosTar(dir: string | null): string[] {
  if (dir === null) return [];
  const rutas: string[] = [];
  let actual = dir;
  for (let nivel = 0; nivel < 3; nivel++) {
    rutas.push(join(actual, 'usr', 'bin', 'tar.exe'), join(actual, 'bin', 'tar.exe'), join(actual, 'tar.exe'));
    const padre = dirname(actual);
    if (padre === actual) break;
    actual = padre;
  }
  return rutas;
}

/* Directorio del `git` que resuelve el PATH. Null si no hay ninguno. */
function raizDeGit(path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue;
    const exe = join(dir, process.platform === 'win32' ? 'git.exe' : 'git');
    try {
      if (statSync(exe).isFile()) return dir;
    } catch {
      /* siguiente directorio del PATH */
    }
  }
  return null;
}
