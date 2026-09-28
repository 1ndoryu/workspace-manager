/* Rutas de la tab PC (/api/pc/*): interfaz del limpiador-pc.
 * [por que] Dominio propio como gate/config/documentos: el server es dueño
 * de ejecutar el binario (resolver, versionar, cola serial) y el cliente
 * solo pide análisis/limpieza y presenta resultados. Un solo análisis global
 * (sin fases en la UI): el escaneo se sirve por SSE para mostrar el progreso
 * en vivo y el reporte unido persiste para rehidratar al recargar. Devuelve
 * true si atendió la ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, leerBody } from './http.js';
import { estadoBinario, reconstruirBinario } from './pc/binario.js';
import { escanearTodo, estadoScan, leerReporte, limpiarPc } from './pc/ejecucion.js';
import type { EventoScan } from './pc/ejecucion.js';

export async function manejarRutasPc(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  /* Estado del binario + último análisis guardado (rehidrata sin escanear). */
  if (ruta === '/api/pc/estado') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    try {
      const bin = await estadoBinario();
      json(res, 200, { ...bin, reporte: leerReporte(), scan: estadoScan() });
    } catch (err) {
      json(res, 500, { error: 'No se pudo leer el estado', detalle: String(err) });
    }
    return true;
  }

  /* Análisis global por SSE (solo lectura, guarda el reporte para limpiar).
   * Eventos: inicio (fase i/n) → avance (qué carpeta se mide) → fase
   * (entradas parciales) → fin (totales).
   * [por que] El trabajo es único en el server: si ya hay un scan en curso
   * (pestaña recargada, doble clic) este GET se adjunta a él —reenvío de lo
   * completado + en vivo— en vez de arrancar otro. El análisis nunca muere
   * por recargar: vive en el server hasta el fin. */
  if (ruta === '/api/pc/escanear') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    /* El análisis completo roza los minutos: sin timeout de socket. */
    try {
      res.socket?.setTimeout(0);
    } catch {
      /* best-effort */
    }
    const enviar = (ev: EventoScan): void => {
      try {
        res.write(`event: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`);
      } catch {
        /* cliente desconectado: el scan termina igual en background */
      }
    };
    try {
      await escanearTodo(enviar);
    } catch (err) {
      enviar({ tipo: 'error', fase: 'area', etiqueta: '', detalle: String(err) });
    }
    res.end();
    return true;
  }

  /* Borrado real (sin simulación): exige la palabra de confirmación. */
  if (ruta === '/api/pc/limpiar') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as { seleccion?: unknown; confirmacion?: unknown };
    if (body.confirmacion !== 'BORRAR') {
      json(res, 400, { error: 'falta la confirmación de borrado' });
      return true;
    }
    try {
      json(res, 200, await limpiarPc(body.seleccion));
    } catch (err) {
      json(res, 500, { error: 'Falló la limpieza', detalle: String(err) });
    }
    return true;
  }

  /* Reconstrucción manual (flujo de actualización del roadmap). */
  if (ruta === '/api/pc/reconstruir') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    try {
      const bin = await reconstruirBinario();
      json(res, 200, { ok: true, bin, ...(await estadoBinario()) });
    } catch (err) {
      json(res, 500, { error: 'Falló la reconstrucción', detalle: String(err) });
    }
    return true;
  }

  return false;
}
