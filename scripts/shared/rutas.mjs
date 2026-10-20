/* Raíces del sistema de archivos para los scripts `.mjs`.
 * [por que] Gemelo de `src/shared/rutas.ts`: node ejecuta los `.mjs` sueltos y
 * no puede importar TypeScript, así que la derivación se repite. Es el único
 * sitio donde se permite: el resto de scripts importa de aquí. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Raíz del repo de workspace-manager (donde está `package.json`). */
export const RAIZ_REPO = join(AQUI, '..', '..');

/* Nombre del propio tablero: el de su carpeta. Gemelo de `NOMBRE_MANAGER` de
 * `src/shared/rutas.ts`; `WS_NOMBRE` lo pisa. */
export const NOMBRE_MANAGER = process.env.WS_NOMBRE || basename(RAIZ_REPO);

/** Directorio que contiene los proyectos; por defecto el repo cuelga de él. */
export const RAIZ_AREA = process.env.WS_AREA_ROOT || dirname(RAIZ_REPO);

/** Carpeta de skills del agente (índice en AGENTS §11). */
export const CARPETA_SKILLS = process.env.WS_SKILLS_ROOT || join(homedir(), '.agents', 'skills');
/** Carpeta de herramientas de calidad dentro del área (gemelo de NOMBRE_QUALITY_TOOLS de src/server/plataforma/rutas.ts). */
export const NOMBRE_QUALITY_TOOLS = '.quality-tools';
/** Carpeta que agrupa las réplicas de herramientas en la 89 (`_quality-tools/<proyecto>/`). */
export const NOMBRE_QUALITY_TOOLS_REMOTO = '_quality-tools';

/** Carpeta que instala GlorySentinel bajo %LOCALAPPDATA% (gemelo de `NOMBRE_SENTINEL` de src/server/plataforma/rutas.ts). */
export const NOMBRE_SENTINEL = 'GlorySentinel';

/** Raíz de los temporales (gemelo de `src/server/plataforma/sistema/temporales.ts`).
 * [por que] Varios scripts escribían `C:/tmp/...` a mano: en Linux eso es una
 * ruta RELATIVA al cwd, no la raíz de temporales. Aquí se resuelve una vez, con
 * la misma regla que el servidor (Windows `C:/tmp`, Linux `~/tmp`, y `WM_TMP`
 * gana sobre ambas). */
export function raizTemporales(env = process.env, plataforma = process.platform, casa = homedir()) {
  const declarada = env.WM_TMP?.trim();
  if (declarada) return declarada;
  return plataforma === 'win32' ? 'C:/tmp' : join(casa, 'tmp');
}

/* Config privada del área: registro de proyectos y ficha del taller. No se
 * versiona (ver `config/ejemplos/`), porque lleva rutas de esta máquina y la
 * lista de proyectos. `WS_CONFIG_ROOT` permite moverla.
 *
 * [por que] Es una función y no una constante: los tests apuntan a un
 * directorio temporal cambiando `WS_CONFIG_ROOT`, y una constante evaluada al
 * importar llegaría tarde. */
export function dirConfigPrivada(raizRepo = RAIZ_REPO) {
  return process.env.WS_CONFIG_ROOT || join(raizRepo, 'config');
}

/** Ruta de un fichero de la config privada.
 * [por que] `raizRepo` es opcional: los scripts que ya reciben la raíz del repo
 * (los `alta`/`cierre`/`gate`, con su fixture de test) la pasan, y los que
 * derivan de su propia ubicación la omiten. `WS_CONFIG_ROOT` gana sobre ambos,
 * que es lo que permite sacar la config del árbol del repo. */
export function rutaConfigPrivada(nombre, raizRepo = RAIZ_REPO) {
  return join(dirConfigPrivada(raizRepo), nombre);
}

/* [por que] Falla temprano y con remedio: sin la config el script moría con un
 * ENOENT crudo que no decía qué copiar ni dónde. */
export function exigirConfigPrivada(nombre) {
  const ruta = rutaConfigPrivada(nombre);
  if (!existsSync(ruta)) {
    const ejemplo = nombre.replace(/\.json$/, '.example.json');
    throw new Error(
      `falta la config privada '${nombre}' en ${dirConfigPrivada()}. ` +
      `Cópiala de config/ejemplos/${ejemplo} y ajústala a tu máquina.`,
    );
  }
  return ruta;
}
