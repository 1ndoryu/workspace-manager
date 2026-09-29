/* Rutas de la tab repos (/api/repos/*): detalle de sincronizacion por repo
 * (que se va a subir, que hay por traer, que hay sin commitear).
 * [por que] Dominio propio como gate/pc: el snapshot trae conteos
 * (ahead/behind/dirty) pero no el contenido; el detalle se calcula bajo
 * demanda para no encarecer el escaneo del area. Solo lectura (log, diff,
 * status): sin fetch, sin push, sin stage. Devuelve true si atendio la
 * ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './http.js';
import { snapshotArea } from './snapshot.js';
import { detalleSync } from './scanner/git.js';

export async function manejarRutasRepos(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  /* Detalle de sync: la clave se resuelve desde el snapshot (anti-traversal,
   * mismo patron que /api/proyecto/gate); 404 si no existe o no es git. */
  if (ruta === '/api/repos/detalle') {
    const clave = url.searchParams.get('clave') ?? '';
    const { snapshot } = snapshotArea(false);
    const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
    if (!proyecto || !proyecto.esGit) {
      json(res, 404, { error: 'Proyecto no encontrado o no es git', clave });
      return true;
    }
    json(res, 200, { clave, ...detalleSync(proyecto.ruta) });
    return true;
  }
  return false;
}
