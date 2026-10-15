/* Ruta del taller remoto (/api/taller/estado, S3): devuelve la conformidad evaluada y el
 * estado que la sustenta (VPS 89, HTTP público y laptop). Lo calcula `estado.ts` con caché
 * de 60 s; `?forzar=1` salta la caché.
 * [por que] No se devuelve la lista completa de procesos del laptop: es grande y el panel
 * solo necesita el recuento y las escuchas. Devuelve true si atendió la ruta. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import { estadoTaller } from './estado.js';

export async function manejarRutasTaller(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  if (ruta !== '/api/taller/estado') return false;
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  const forzar = url.searchParams.get('forzar') === '1';
  try {
    const { tomadoEn, hallazgos, entrada } = await estadoTaller(forzar);
    json(res, 200, {
      tomadoEn,
      hallazgos,
      taller89: entrada.t89,
      motivoSinLectura: entrada.motivoSinLectura ?? null,
      publico: entrada.publico,
      local: {
        procesosTotal: entrada.local.procesos.length,
        escuchas: entrada.local.escuchas,
        mutagen: entrada.local.mutagen,
        sinLectura: entrada.local.sinLectura ?? null,
      },
      registro: entrada.registro,
    });
  } catch (err) {
    json(res, 500, { error: 'No se pudo evaluar el taller', detalle: String(err) });
  }
  return true;
}
