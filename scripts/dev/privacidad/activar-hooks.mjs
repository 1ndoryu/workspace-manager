/* Activa los hooks versionados de `.githooks/` (detector de datos personales, 19AA-12).
 * Se ejecuta con `npm install` (script `prepare`). [por que] Sin este paso el hook de
 * privacidad no corre en un clon nuevo: `core.hooksPath` vive en la config local de Git y
 * no se versiona. Fuera de un repo Git (réplica de Mutagen en la 89, instalación desde un
 * tarball) no hay nada que activar: sale sin error. */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Devuelve 'activado' | 'sin-git' | 'error'. `git` se inyecta para poder probarlo sin tocar la config real. */
export function activarHooks(raiz = RAIZ, git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })) {
  // [por que] `.git` puede ser carpeta o fichero (submódulos y worktrees): basta con que exista.
  if (!existsSync(join(raiz, '.git'))) return 'sin-git';
  const r = git(['config', 'core.hooksPath', '.githooks'], raiz);
  return r.status === 0 ? 'activado' : 'error';
}

const esCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esCli) {
  const estado = activarHooks();
  if (estado === 'error') {
    console.error('activar-hooks: no se pudo fijar core.hooksPath; ejecuta a mano: git config core.hooksPath .githooks');
    process.exit(1);
  }
}
