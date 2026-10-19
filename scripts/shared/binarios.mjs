/* Binarios del sistema que el manager lanza. Definición única para los scripts.
 * [por qué] Gemelo de `src/shared/binarios.ts`: node ejecuta los `.mjs` sueltos y
 * no puede importar TypeScript, así que la derivación se repite. Es el único sitio
 * donde se permite (igual que en `rutas.mjs` y `puertos.mjs`); el resto de scripts
 * importa de aquí. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

function binario(valor, defecto) {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : defecto;
}

/** Cliente SSH: el transporte al taller, los túneles y la lectura del estado de la 89. */
export const BIN_SSH = binario(process.env.WS_SSH, 'ssh');

/** Empaquetador de la copia del runtime a la VPS (`tar` por ssh, no `scp -r`). */
export const BIN_TAR = binario(process.env.WS_TAR, 'tar');

/** Git del escáner: rama, HEAD, diffs y estado del árbol. */
export const BIN_GIT = binario(process.env.WS_GIT, 'git');

/* Busca npm en el PATH, junto a node y en ~/.local/bin. [por qué] En la 89 el PATH de
 * un shell no interactivo no trae ~/.local/bin, así que `npm` a secas da exit 127. */
function buscarNpm() {
  const nombres = process.platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm'];
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    dirname(process.execPath),
    join(homedir(), '.local', 'bin'),
  ];
  for (const dir of dirs.filter(Boolean)) {
    for (const nombre of nombres) {
      const ruta = join(dir, nombre);
      if (existsSync(ruta)) return ruta;
    }
  }
  return null;
}

/** npm de los scripts de calidad (instalar, compilar y probar consumidores). */
export const BIN_NPM = binario(process.env.WS_NPM, buscarNpm() ?? 'npm');
