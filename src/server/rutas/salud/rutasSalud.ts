/* Rutas de salud (10AA-2 F8): /api/salud (todos los proyectos, o `?clave=` uno) y
 * /api/salud/area (comprobaciones del área y del entorno). Solo lectura; `?forzar=1`
 * salta el caché de 60 s y recalcula.
 * [por que] Misma convención que las demás rutas: true si atendió la ruta, false si no
 * es suya, y 405 para verbos que no son GET. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../../http.js';
import { saludArea, saludProyectos } from '../../salud/runner.js';

export async function manejarRutasSalud(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  if (ruta !== '/api/salud' && ruta !== '/api/salud/area') return false;
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  const forzar = url.searchParams.get('forzar') === '1';
  if (ruta === '/api/salud/area') {
    json(res, 200, await saludArea(forzar));
    return true;
  }
  const porProyecto = await saludProyectos(forzar);
  const clave = url.searchParams.get('clave');
  if (clave === null) {
    json(res, 200, { proyectos: [...porProyecto.values()] });
    return true;
  }
  const resultado = porProyecto.get(clave);
  if (!resultado) {
    json(res, 404, { error: `Proyecto no encontrado: ${clave}` });
    return true;
  }
  json(res, 200, resultado);
  return true;
}
