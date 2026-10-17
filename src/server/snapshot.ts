/* Snapshot del workspace con caché (escáner con flag `forzar`).
 * [por que] Extraído de `index.ts` (límite-líneas): las rutas del gate, de
 * config y de documentos lo consumen sin importar el entry (sin ciclos). */
import { obtenerSnapshot } from './cache.js';
import { escanearWorkspace } from './scanner/workspace.js';
import { CARPETA_SKILLS, RAIZ_AREA } from '../shared/rutas.js';

/* Escáner con caché; el flag `forzar` re-escanea. */
export function snapshotArea(forzar: boolean) {
  return obtenerSnapshot(
    RAIZ_AREA,
    () => escanearWorkspace({ raiz: RAIZ_AREA, carpetaSkills: CARPETA_SKILLS }),
    forzar,
  );
}
