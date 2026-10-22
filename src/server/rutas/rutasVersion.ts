/* Ruta /api/version (2026-10-22): la versión que sirve este backend y el changelog.
 * [por que con el commit y la hora de arranque] «¿Está actualizada la app?» no se contesta con un
 * número: hace falta saber si el proceso en marcha va por detrás del código en disco. El front
 * compara `arrancadoEn` con `fecha` y, si arrancó antes del último commit, lo dice. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import { infoVersion, leerChangelog } from '../version/info.js';

/* `_url` no se usa: la ruta basta y viene ya normalizada por el despachador. */
export async function manejarRutasVersion(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  ruta: string,
): Promise<boolean> {
  if (ruta !== '/api/version' && ruta !== '/api/version/changelog') return false;
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  if (ruta === '/api/version/changelog') {
    json(res, 200, { texto: leerChangelog() });
    return true;
  }
  json(res, 200, await infoVersion());
  return true;
}
