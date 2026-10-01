/* Rutas del mando dev (/api/dev/*): vigilancia F0b.
 * [por que] Dominio propio como pc/repos: el server es dueno de ejecutar el
 * doctor (mismo proceso, cache TTL 60s) y el cliente solo pide el informe y
 * lo presenta en la consola. Devuelve true si atendio la ruta, false si no
 * es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import { obtenerVigilancia } from '../dev/vigilancia.js';

export async function manejarRutasDev(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  /* Informe del doctor sobre el snapshot vigente + frescura (rehidrata la
   * consola sin re-escanear: el server cachea 60s). */
  if (ruta === '/api/dev/estado') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    void url;
    try {
      const { informe, escaneadoHaceMs } = await obtenerVigilancia();
      json(res, 200, { ...informe, escaneadoHaceMs });
    } catch (err) {
      json(res, 500, { error: 'No se pudo vigilar el mando dev', detalle: String(err) });
    }
    return true;
  }
  return false;
}
