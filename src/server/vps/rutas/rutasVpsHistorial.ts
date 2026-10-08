/* Historial persistente por despliegue (/api/vps/historial, 07AA-4 F2).
 * [por que] Archivo aparte como las piezas: no engorda rutasVps.ts (ya con
 * aviso de limite-lineas) y la factoría con historial inyectado se testea sin
 * tocar el fichero de producción. Solo lectura del fichero acotado. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../../http.js';
import type { VpsHistorialSitio } from '../../../shared/types.js';
import { claveValida, crearHistorial, historialProd } from '../historial.js';

export interface DepsHistorial {
  historial?: ReturnType<typeof crearHistorial>;
}

export function crearManejadorHistorial(deps: DepsHistorial = {}) {
  const historial = deps.historial ?? historialProd();

  return async function manejarRutasVpsHistorial(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ruta: string,
  ): Promise<boolean> {
    if (ruta !== '/api/vps/historial') return false;
    const clave = url.searchParams.get('clave') ?? '';
    if (!claveValida(clave)) {
      json(res, 400, { error: 'clave-invalida', clave });
      return true;
    }
    const respuesta: VpsHistorialSitio = { clave, muestras: historial.leer(clave) };
    json(res, 200, respuesta);
    return true;
  };
}

/* Manejador de producción (fichero real en data/). */
export const manejarRutasVpsHistorial = crearManejadorHistorial();
