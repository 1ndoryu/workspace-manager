/* Binarios del sistema que el manager lanza. Definición única: el resto del código
 * importa de aquí.
 * [por qué] Estaban escritos a mano en veinte sitios, y su ubicación no es un dato
 * del código: `ssh` puede ser el OpenSSH de Windows (una característica opcional,
 * que puede no estar) o el de Git; `tar` el de Windows o el de Git/MSYS; `git` y
 * `npm` los de una instalación que no está en el PATH. Con el prefijo `WS_` (el
 * mismo de `WS_AREA_ROOT`/`WS_CONFIG_ROOT`/`WS_PORT`) se apuntan sin tocar nada;
 * sin variable valen los nombres del PATH, que es lo correcto en cualquier máquina
 * donde estén instalados. Los que son la forma de un adaptador de plataforma y no
 * una ruta que alguien quiera mover (el `powershell.exe` de la sonda local, el
 * `where.exe` del doctor) se quedan donde están, con su porqué escrito allí.
 *
 * Gemelo de `scripts/shared/binarios.mjs` (los `.mjs` sueltos no pueden importar
 * TypeScript; es la misma duplicación documentada que en `rutas` y `puertos`).
 *
 * Solo servidor: lee `process.env`, que en el navegador no existe. Ningún
 * componente del front debe importarlo. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

function binario(valor: string | undefined, defecto: string): string {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : defecto;
}

/** Cliente SSH: el transporte al taller, los túneles y la lectura del estado de la 89. */
export const BIN_SSH = binario(process.env.WS_SSH, 'ssh');

/** Empaquetador de la copia del runtime a la VPS (`tar` por ssh, no `scp -r`). */
export const BIN_TAR = binario(process.env.WS_TAR, 'tar');

/** Git del escáner: rama, HEAD, diffs y estado del árbol. */
export const BIN_GIT = binario(process.env.WS_GIT, 'git');

/* Busca npm en el PATH, junto a node y en ~/.local/bin. [por qué] Igual que el gemelo
 * `scripts/shared/binarios.mjs`: en la 89 el PATH de un shell no interactivo no trae
 * ~/.local/bin, y `npm` a secas da exit 127. Dos derivaciones distintas darían dos npm. */
function buscarNpm(): string | null {
  const nombres = process.platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm'];
  const dirs = [...(process.env.PATH ?? '').split(delimiter), dirname(process.execPath), join(homedir(), '.local', 'bin')];
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
