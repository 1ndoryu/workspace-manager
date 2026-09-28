/* Rutas de la tab PC (/api/pc/*): interfaz del limpiador-pc.
 * [por que] Dominio propio como gate/config/documentos: el server es dueño
 * de ejecutar el binario (resolver, versionar, cola serial) y el cliente
 * solo pide análisis/limpieza y presenta resultados. Devuelve true si
 * atendió la ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, leerBody } from './http.js';
import { estadoBinario, reconstruirBinario } from './pc/binario.js';
import { FASES_PC, esFasePc, escanearPc, leerMeta, limpiarPc } from './pc/ejecucion.js';
import type { FasePc } from './pc/ejecucion.js';

export async function manejarRutasPc(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  /* Estado del binario + fases con su meta (sin construir nada). */
  if (ruta === '/api/pc/estado') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    try {
      const bin = await estadoBinario();
      const fases = (Object.keys(FASES_PC) as FasePc[]).map((fase) => ({
        fase,
        etiqueta: FASES_PC[fase].etiqueta,
        descripcion: FASES_PC[fase].descripcion,
        meta: leerMeta(fase),
      }));
      json(res, 200, { ...bin, fases });
    } catch (err) {
      json(res, 500, { error: 'No se pudo leer el estado', detalle: String(err) });
    }
    return true;
  }

  /* Análisis de una fase (solo lectura, guarda el reporte para limpiar). */
  if (ruta === '/api/pc/escanear') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as { fase?: unknown };
    if (!esFasePc(body.fase)) {
      json(res, 400, { error: 'fase inválida (area | caches | extern | vscode | chrome)' });
      return true;
    }
    try {
      json(res, 200, await escanearPc(body.fase));
    } catch (err) {
      json(res, 500, { error: 'Falló el análisis', detalle: String(err) });
    }
    return true;
  }

  /* Limpieza: seca por defecto; con ejecutar=true exige confirmación. */
  if (ruta === '/api/pc/limpiar') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Método no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as {
      fase?: unknown;
      ejecutar?: unknown;
      solo?: unknown;
      confirmacion?: unknown;
    };
    if (!esFasePc(body.fase)) {
      json(res, 400, { error: 'fase inválida (area | caches | extern | vscode | chrome)' });
      return true;
    }
    const ejecutar = body.ejecutar === true;
    if (ejecutar && body.confirmacion !== 'BORRAR') {
      json(res, 400, { error: 'falta la confirmación de borrado' });
      return true;
    }
    try {
      json(res, 200, await limpiarPc(body.fase, ejecutar, body.solo));
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
