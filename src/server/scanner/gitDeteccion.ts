/* Deteccion de repos con el sistema de archivos: si una carpeta es repo,
 * worktree o nada, y donde esta su gitdir. Nada de esto arranca un proceso.
 * [por que] `git rev-parse --is-inside-work-tree` costaba ~37 ms por carpeta
 * no-repo (594 ms en el escaneo raiz del area, medido el 2026-10-17): la
 * respuesta esta en el filesystem. Corte de scanner/git.ts (17AA-2). */
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface InfoGit {
  esRepo: boolean;
  esWorktree: boolean;
  padre: string | null;
}

/** Detecta si una carpeta es repo Git (carpeta .git) o worktree (archivo .git). */
export function detectarGit(ruta: string): InfoGit {
  const gitPath = join(ruta, '.git');
  /* [por que] lstatSync NO sigue symlinks: un symlink roto (destino inexistente)
   * hace que statSync lance ENOENT y el repo se pierda (caso GLORYINSPECTOR). */
  const stat = lstatOrNull(gitPath);
  if (stat?.isDirectory()) {
    return { esRepo: true, esWorktree: false, padre: null };
  }
  if (stat) {
    /* Un `.git` que es enlace (o junction) se resuelve aqui: si apunta a una
     * carpeta es un gitdir; si apunta a un archivo, un worktree. [por que] Antes
     * esto lo decidia `git rev-parse --is-inside-work-tree`, un proceso por
     * carpeta (~37 ms medidos: 16 carpetas no-repo del area = 594 ms por
     * escaneo). */
    const destino = stat.isSymbolicLink() ? realpathOrNull(gitPath) : gitPath;
    const statDestino = destino ? lstatOrNull(destino) : null;
    if (statDestino?.isDirectory()) {
      return { esRepo: true, esWorktree: false, padre: null };
    }
    if (statDestino?.isFile()) {
      /* worktree: .git es un archivo con "gitdir: <ruta>" */
      try {
        const m = readFileSync(destino as string, 'utf8').match(/gitdir:\s*(.+)/);
        if (m) {
          return { esRepo: true, esWorktree: true, padre: m[1].trim() };
        }
      } catch {
        /* sin lectura -> no es repo */
      }
    }
  }
  /* Sin `.git` propio: git solo lo reconoceria si la carpeta esta dentro del
   * arbol de trabajo de un repo de mas arriba, y eso se responde subiendo. */
  if (dentroDeArbol(ruta)) {
    return { esRepo: true, esWorktree: false, padre: null };
  }
  return { esRepo: false, esWorktree: false, padre: null };
}

/* ¿La carpeta esta dentro de un arbol de trabajo? Es la pregunta que responde
 * `git rev-parse --is-inside-work-tree`, hecha con el filesystem. */
function dentroDeArbol(ruta: string): boolean {
  let dir = resolve(ruta);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const padre = dirname(dir);
    if (padre === dir) return false;
    dir = padre;
  }
}

function lstatOrNull(ruta: string) {
  try {
    return lstatSync(ruta);
  } catch {
    return null;
  }
}

function realpathOrNull(ruta: string) {
  try {
    return realpathSync(ruta);
  } catch {
    return null;
  }
}
/* Ruta real del gitdir de un repo (o null si no se puede resolver sin git).
 * [por que] En un worktree el `.git` es un archivo `gitdir: <ruta>` y tanto su
 * config como sus worktrees viven en el repo principal. Resolverlo leyendo el
 * archivo evita arrancar `git` solo para preguntarlo. */
export function gitdirDe(ruta: string): string | null {
  const gitPath = join(ruta, '.git');
  const stat = lstatOrNull(gitPath);
  if (stat?.isDirectory()) return gitPath;
  if (!stat) return null;
  /* Un `.git` enlazado se resuelve antes de leerlo (misma regla que
   * `detectarGit`): si el enlace apunta a una carpeta, esa carpeta es el gitdir. */
  const destino = stat.isSymbolicLink() ? realpathOrNull(gitPath) : gitPath;
  if (!destino) return null;
  const statDestino = lstatOrNull(destino);
  if (statDestino?.isDirectory()) return destino;
  if (!statDestino?.isFile()) return null;
  try {
    const m = readFileSync(destino, 'utf8').match(/gitdir:\s*(.+)/);
    if (m) return resolve(dirname(destino), m[1].trim());
  } catch {
    /* sin lectura -> no se puede resolver */
  }
  return null;
}

/* Directorio comun del repo: donde estan la config y los worktrees. En un
 * worktree lo dice el archivo `commondir`; en un repo normal es el gitdir. */
export function commondirDe(gitdir: string): string {
  try {
    return resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim());
  } catch {
    return gitdir;
  }
}
