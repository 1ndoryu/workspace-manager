/* Lista de alta de un proyecto (10AA-2 F10): GET /api/proyecto/alta?clave=.
 * [por que] El tablero muestra «Alta: N/11» sin reimplementar las comprobaciones:
 * la lista la decide `scripts/dev/proyecto/alta.mjs` y aquí solo se lanza y se sirve.
 * Devuelve true si atendió la ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import { snapshotArea } from '../snapshot.js';
import { resumirAlta } from '../dev/alta.js';

export async function manejarRutasAlta(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  if (ruta !== '/api/proyecto/alta') return false;
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  const clave = url.searchParams.get('clave') ?? '';
  if (clave === '') {
    json(res, 400, { error: 'Falta la clave del proyecto' });
    return true;
  }
  const { snapshot } = await snapshotArea(false);
  const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
  if (!proyecto) {
    json(res, 404, { error: 'Proyecto no encontrado', clave });
    return true;
  }
  const r = await resumirAlta(proyecto.ruta);
  if (!r.ok) {
    json(res, 500, { error: 'No se pudo calcular la alta', clave, detalle: r.error });
    return true;
  }
  json(res, 200, { clave, ...r.resumen });
  return true;
}
