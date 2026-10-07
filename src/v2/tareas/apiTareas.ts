/* Cliente HTTP de la tab tareas: habla con /api/tareas/* (proxy F2).
 * [por que] Capa fina sobre axios como apiVps.ts; sin cache de modulo (cada
 * carga es fresca: el orden lo decide TASKS y puede cambiar fuera). El error
 * se convierte a mensaje legible con el motivo del puente (503 honesto con
 * motivo, 429 cuota, 404 proyecto) para pintarlo tal cual. */
import axios from 'axios';
import {
  tareasDeRespuesta,
  type TareaTab,
  type TareasEstado,
  type TareasMovimientoTab,
} from '../../shared/tareasTab.js';

function mensajeFallo(operacion: string, err: unknown): Error {
  const resp = axios.isAxiosError(err) ? err.response : undefined;
  const datos = resp?.data as { error?: unknown; motivo?: unknown } | undefined;
  const detalle =
    (typeof datos?.error === 'string' && datos.error) ||
    (typeof datos?.motivo === 'string' && datos.motivo) ||
    (resp ? `HTTP ${resp.status}` : 'sin respuesta del servidor');
  return new Error(`${operacion}: ${detalle}`);
}

export async function estadoTareas(): Promise<TareasEstado> {
  try {
    const { data } = await axios.get<TareasEstado>('/api/tareas/estado');
    return {
      configurado: data.configurado === true,
      disponible: data.disponible === true,
      motivo: typeof data.motivo === 'string' ? data.motivo : null,
    };
  } catch (err) {
    throw mensajeFallo('estado de tareas', err);
  }
}

export async function proyectoTareas(legacyId: number): Promise<TareaTab[]> {
  try {
    const { data } = await axios.get('/api/tareas/proyecto', { params: { legacy_id: legacyId } });
    return tareasDeRespuesta(data).sort((a, b) => a.orden - b.orden);
  } catch (err) {
    throw mensajeFallo(`columna ${legacyId}`, err);
  }
}

export async function reordenarTareas(movimientos: TareasMovimientoTab[]): Promise<number> {
  try {
    const { data } = await axios.post<{ actualizadas?: unknown }>('/api/tareas/reordenar', {
      movimientos,
    });
    return typeof data.actualizadas === 'number' ? data.actualizadas : 0;
  } catch (err) {
    throw mensajeFallo('reordenar', err);
  }
}
