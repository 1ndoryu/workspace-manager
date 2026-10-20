/* Historial de recursos del tablero (/api/recursos/historial, 20AA-17).
 * [por que] Archivo aparte, como las piezas: la factoría con el historial inyectado
 * se testea sin tocar el fichero de producción, y aquí solo se lee. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import type { RecursosHistorialRespuesta } from '../../shared/types.js';
import { esTabRecursos } from '../../shared/recursosHistorial.js';
import { historialRecursosProd, type crearHistorialRecursos } from './historial.js';

export interface DepsRecursos {
  historial?: ReturnType<typeof crearHistorialRecursos>;
}

export function crearManejadorRecursos(deps: DepsRecursos = {}) {
  const historial = deps.historial ?? historialRecursosProd();

  return async function manejarRutasRecursos(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ruta: string,
  ): Promise<boolean> {
    if (ruta !== '/api/recursos/historial') return false;
    const tab = url.searchParams.get('tab') ?? '';
    /* Fail-closed: otra clave no tiene anillo y no se inventa. */
    if (!esTabRecursos(tab)) {
      json(res, 400, { error: 'tab-invalido', tab });
      return true;
    }
    const respuesta: RecursosHistorialRespuesta = { tab, muestras: historial.leer(tab) };
    json(res, 200, respuesta);
    return true;
  };
}

/* Manejador de producción (fichero real en data/). */
export const manejarRutasRecursos = crearManejadorRecursos();
