/* Snapshot del workspace con caché (escáner con flag `forzar`).
 * [por que] Extraído de `index.ts` (límite-líneas): las rutas del gate, de
 * config y de documentos lo consumen sin importar el entry (sin ciclos). */
import { obtenerSnapshot, type CacheResultado } from './cache.js';
import { escanearWorkspace, refrescarGit } from './scanner/workspace.js';
import { PUERTO_GIT } from './scanner/git.js';
import { CARPETA_SKILLS, RAIZ_AREA } from './plataforma/rutas.js';

/* Quien quiere enterarse de cada escaneo de verdad (20AA-10 F6).
 * [por que un registro y no un import] Esto es la capa baja de la que tiran todas las rutas; la
 * sincronia del roadmap necesita a la vez el snapshot (los proyectos) y el puente de TASK, y solo
 * quien compone el servidor (`index.ts`) tiene las dos piezas. Importarlas aqui seria un ciclo. */
let alEscanear: (() => void) | null = null;

export function alEscanearWorkspace(fn: (() => void) | null): void {
  alEscanear = fn;
}

/* Escáner con caché; el flag `forzar` re-escanea. */
export async function snapshotArea(forzar: boolean): Promise<CacheResultado> {
  const resultado = await obtenerSnapshot(
    RAIZ_AREA,
    () => escanearWorkspace({ raiz: RAIZ_AREA, carpetaSkills: CARPETA_SKILLS, puerto: PUERTO_GIT }),
    forzar,
    (snapshot) => refrescarGit(snapshot, PUERTO_GIT),
  );
  /* Solo cuando el escaneo ha sido de verdad: si el snapshot salio de cache, los roadmaps del
   * disco no se han vuelto a mirar y avisar aqui dispararia la sincronia en cada GET. */
  if (!resultado.desdeCache) alEscanear?.();
  return resultado;
}
