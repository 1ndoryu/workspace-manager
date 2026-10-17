/* Raíces del sistema de archivos, en un solo sitio.
 * [por que] Cada módulo llevaba su propio literal `C:/Users/usuario/…` (20
 * ficheros de código), que además de duplicar la ruta impedía publicar el
 * repo: un clon ajeno heredaba la ruta de esta máquina. Aquí se derivan de
 * dónde vive el módulo y del home del usuario, y cada una se puede pisar por
 * entorno para quien tenga otra disposición.
 *
 * El repo se deriva de `import.meta.url`, así que vale igual desde `src/`
 * (tsx, tests) y desde `dist-server/` (servidor compilado): en ambos casos
 * subir dos niveles desde `shared/` da la raíz del repo. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Raíz del repo de workspace-manager (donde está `package.json`). */
export const RAIZ_REPO = join(AQUI, '..', '..');

/* [por que] El área es el directorio que contiene los proyectos; por defecto
 * el repo cuelga de ella. Quien clone el manager suelto pone WS_AREA_ROOT. */
export const RAIZ_AREA = process.env.WS_AREA_ROOT || dirname(RAIZ_REPO);

/** Carpeta de skills del agente (índice en AGENTS §11). */
export const CARPETA_SKILLS = process.env.WS_SKILLS_ROOT || join(homedir(), '.agents', 'skills');

/* Config privada del área: registro de proyectos y ficha del taller. No se
 * versiona (ver `config/ejemplos/`), porque lleva rutas de esta máquina y la
 * lista de proyectos. `WS_CONFIG_ROOT` permite moverla.
 *
 * [por que] Es una función y no una constante: los tests apuntan a un
 * directorio temporal cambiando `WS_CONFIG_ROOT`, y una constante evaluada al
 * importar llegaría tarde. */
export function dirConfigPrivada(raizRepo: string = RAIZ_REPO): string {
  return process.env.WS_CONFIG_ROOT || join(raizRepo, 'config');
}

/** Ruta de un fichero de la config privada.
 * [por que] `raizRepo` es opcional: los scripts que ya reciben la raíz del repo
 * (los `alta`/`cierre`/`gate`, con su fixture de test) la pasan, y los que
 * derivan de su propia ubicación la omiten. `WS_CONFIG_ROOT` gana sobre ambos,
 * que es lo que permite sacar la config del árbol del repo. */
export function rutaConfigPrivada(nombre: string, raizRepo: string = RAIZ_REPO): string {
  return join(dirConfigPrivada(raizRepo), nombre);
}

/* [por que] Falla temprano y con remedio: sin la config el proceso moría con un
 * ENOENT crudo que no decía qué copiar ni dónde. */
export function exigirConfigPrivada(nombre: string): string {
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
