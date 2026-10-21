/* Ruta del taller remoto (/api/taller/estado, S3): devuelve la conformidad evaluada y el
 * estado que la sustenta (VPS 89, HTTP público y laptop). Lo calcula `estado.ts` con caché
 * de 60 s; `?forzar=1` salta la caché.
 * [por que] No se devuelve la lista completa de procesos del laptop: es grande y el panel
 * solo necesita el recuento y las escuchas. Devuelve true si atendió la ruta. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import { estadoTaller } from './estado.js';
import { rearmesRecientes, revisarTuneles } from './tuneles.js';

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
    const { tomadoEn, host, hallazgos, entrada, historial, motivoHistorial } = await estadoTaller(forzar);
    json(res, 200, {
      tomadoEn,
      host,
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
      historial,
      motivoHistorial,
      /* Protocolo de estado permanente (2026-10-21): cuándo reabrió el supervisor el túnel de
       * cada proyecto. Vive en memoria del servidor: se pierde al reiniciarlo, y es lo que el
       * panel pinta como «rearmado a las HH:MM». */
      rearmes: rearmesRecientes(),
    });
    /* Latido extra del supervisor de túneles (19AA-15): la cadencia de verdad es su propio
     * temporizador (arrancarSupervisor, en index.ts); pedir el estado adelanta la pasada para
     * que quien acaba de abrir el panel no espere al minuto. No se espera: el rearme va por
     * detrás y esta respuesta no depende de él. */
    void revisarTuneles(entrada.t89?.tmux ?? []).catch(() => undefined);
  } catch (err) {
    json(res, 500, { error: 'No se pudo evaluar el taller', detalle: String(err) });
  }
  return true;
}
