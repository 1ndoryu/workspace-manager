/* Escritura de un fichero de texto pedida por HTTP, seguida de un re-escaneo.
 * [por que] Tres handlers repetían el mismo par: escribir y, aparte, un re-escaneo
 * que no debe convertir un guardado correcto en error (un git lock lo tumbaba).
 * Aquí queda la escritura a disco; el handler solo valida y responde. */
import { writeFileSync } from 'node:fs';
import { snapshotArea } from '../../snapshot.js';
import { logger } from '../../../shared/logger.js';

/* Escribe `ruta` (lanza si falla la escritura) y luego re-escanea sin propagar errores. */
export async function guardarYRefrescar(ruta: string, contenido: string, etiqueta: string): Promise<void> {
  writeFileSync(ruta, contenido, 'utf8');
  try {
    await snapshotArea(true);
  } catch (err) {
    logger.warn(`re-escaneo tras guardar [${etiqueta}] fallo:`, err);
  }
}
