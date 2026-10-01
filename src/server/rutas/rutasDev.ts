/* Rutas del mando dev (/api/dev/*): vigilancia F0b + acciones F3.
 * [por que] Dominio propio como pc/repos: el server es dueno de ejecutar el
 * doctor (mismo proceso, cache TTL 60s) y el CLI de acciones (hijo sin
 * shell, snapshot vigente a temporal); el cliente solo pide y presenta en
 * la consola. Devuelve true si atendio la ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, leerBody } from '../http.js';
import { obtenerVigilancia } from '../dev/vigilancia.js';
import { ejecutarAccionDev, type AccionDev } from '../dev/acciones.js';

const ACCIONES: readonly AccionDev[] = ['up', 'stop', 'status', 'logs', 'open'];

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
  /* Acciones del mando (F3): up/stop por POST (mutan), status/logs/open por
   * GET (lectura). El server valida id y propaga { codigo, salida } del CLI;
   * codigo != 0 es estado del area (rehusado/deriva), no fallo HTTP. */
  const m = /^\/api\/dev\/(up|stop|status|logs|open)$/.exec(ruta);
  if (m && (ACCIONES as readonly string[]).includes(m[1])) {
    const accion = m[1] as AccionDev;
    try {
      let id: unknown;
      let lineas: number | undefined;
      if (accion === 'up' || accion === 'stop') {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'Método no permitido' });
          return true;
        }
        id = (await leerBody(req) as { id?: unknown })?.id;
      } else {
        if (req.method !== 'GET') {
          json(res, 405, { error: 'Método no permitido' });
          return true;
        }
        id = url.searchParams.get('id');
        if (accion === 'logs') {
          const n = Number.parseInt(url.searchParams.get('lineas') ?? '50', 10);
          lineas = Number.isInteger(n) ? Math.min(Math.max(n, 1), 200) : 50;
        }
      }
      if (typeof id !== 'string' || id.length === 0) {
        json(res, 400, { error: 'id requerido' });
        return true;
      }
      const r = await ejecutarAccionDev(accion, id, lineas);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { error: `accion dev no ejecutada: ${err instanceof Error ? err.message : String(err)}` });
    }
    return true;
  }
  return false;
}
