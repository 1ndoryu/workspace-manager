/* Cliente HTTP del historial de recursos (/api/recursos/historial, 20AA-17).
 * [por que] Sin caché en memoria a propósito: se pide al abrir el panel y al volver
 * a la pestaña, que es justo cuando lo que hay en memoria se ha quedado atrás. */
import axios from 'axios';
import { RETENCION_RECURSOS_MS, normalizarMuestraRecursos, type MuestraRecursos } from '../../shared/recursosHistorial.js';

export async function historialRecursos(tab: string): Promise<MuestraRecursos[]> {
  const { data } = await axios.get<{ muestras?: unknown }>('/api/recursos/historial', {
    params: { tab },
  });
  if (!data || !Array.isArray(data.muestras)) return [];
  const corte = Date.now() - RETENCION_RECURSOS_MS;
  const limpias: MuestraRecursos[] = [];
  for (const v of data.muestras) {
    const m = normalizarMuestraRecursos(v, corte);
    if (m) limpias.push(m);
  }
  return limpias;
}
