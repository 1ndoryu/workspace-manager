/* Detecta si una carpeta es un worktree de git (copia de trabajo de otro repo).
 * [por que] Un worktree tiene un `.git` que es un archivo (`gitdir: <repo>/.git/worktrees/<nombre>`),
 * no una carpeta. El tablero lo tomaba por un proyecto nuevo sin onboarding y
 * lo marcaba «dev sin botón»: un falso positivo, porque su repo ya tiene botón. */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RE_GITDIR = /^gitdir:\s*(.+?)\/\.git\/worktrees\/[^/\s]+\s*$/m;

/* Ruta del repo principal a partir del contenido del `.git` de un worktree, o null. */
export function repoPrincipalDeArchivoGit(texto) {
  const m = RE_GITDIR.exec(String(texto ?? ''));
  return m ? m[1] : null;
}

/* Repo principal si `ruta` es un worktree; null si es un repo propio o no es repo. */
export function repoPrincipalDeWorktree(ruta) {
  const archivo = join(ruta, '.git');
  if (!existsSync(archivo) || !statSync(archivo).isFile()) return null;
  return repoPrincipalDeArchivoGit(readFileSync(archivo, 'utf8'));
}
