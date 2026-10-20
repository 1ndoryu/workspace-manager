/* Contrato del historial de recursos del tablero (20AA-17): lo que sirve
 * `GET /api/recursos/historial?tab=`. */
import type { MuestraRecursos } from '../recursosHistorial.js';

export interface RecursosHistorialRespuesta {
  tab: string;
  muestras: MuestraRecursos[];
}
