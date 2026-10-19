/* Rutas de la tab PC (/api/pc/*): interfaz del papel `limpiador`.
 * [por que] Dominio propio como gate/config/documentos: el server es dueño
 * de ejecutar el binario (resolver, versionar, cola serial) y el cliente
 * solo pide análisis/limpieza y presenta resultados. Un solo análisis global
 * (sin fases en la UI): el escaneo se sirve por SSE para mostrar el progreso
 * en vivo y el reporte unido persiste para rehidratar al recargar. Devuelve
 * true si atendió la ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { iniciarSse, json, leerBody } from '../http.js';
import { verificarPeticionEscritura } from '../guardian/operacion/seguridad.js';
import { estadoBinario, reconstruirBinario } from '../pc/binario.js';
import { escanearTodo, estadoScan } from '../pc/scan.js';
import { leerReporte } from '../pc/reporte.js';
import { adjuntarLimpieza, estadoLimpieza, limpiarPc, limpiarTodo } from '../pc/limpieza.js';
import type { EventoScan } from '../pc/ejecucion.js';
import type { EventoLimpieza } from '../pc/limpieza.js';

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
      json(res, 200, { ...bin, reporte: leerReporte(), scan: estadoScan(), limpieza: estadoLimpieza() });
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
    const enviar = iniciarSse<EventoScan>(res);
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
      const detalle = String(err);
      /* 409 si hay un trabajo en curso (reintentable); 500 para lo demás.
       * El detalle viaja siempre para que la UI muestre la causa real. */
      json(res, detalle.includes('en curso') ? 409 : 500, { error: 'Falló la limpieza', detalle });
    }
    return true;
  }

  /* Borrado con progreso en vivo por SSE: inicio → fase → fila (cada
   * objetivo al completarse) → fin. Sin selección se adjunta al borrado en
   * curso (recarga a mitad).
   * [por que] El borrado de GB tarda minutos en silencio: la UI muestra
   * en vivo qué se está borrando en vez de esperar al total. Es POST con
   * JSON y la guardia de escritura (Origin, Host, Content-Type): un GET que
   * borra no debe depender solo del token. */
  if (ruta === '/api/pc/limpiar-stream') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    const veredicto = verificarPeticionEscritura(req.headers);
    if (!veredicto.ok) {
      json(res, veredicto.status, { error: veredicto.motivo });
      return true;
    }
    const body = (await leerBody(req)) as { seleccion?: unknown; confirmacion?: unknown };
    if (body.confirmacion !== 'BORRAR') {
      json(res, 400, { error: 'falta la confirmación de borrado' });
      return true;
    }
    const seleccion: unknown = body.seleccion ?? null;
    const enviar = iniciarSse<EventoLimpieza>(res);
    try {
      if (seleccion === null) {
        /* Sin selección: adjunta al borrado en curso (recarga a mitad). */
        const enCurso = adjuntarLimpieza(enviar);
        if (!enCurso) {
          enviar({ tipo: 'error', fase: 'area', etiqueta: '', detalle: 'sin borrado en curso' });
        } else {
          await enCurso;
        }
      } else {
        await limpiarTodo(seleccion, enviar);
      }
    } catch (err) {
      enviar({ tipo: 'error', fase: 'area', etiqueta: '', detalle: String(err) });
    }
    res.end();
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
