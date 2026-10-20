/* Cliente HTTP de la tab tareas: habla con /api/tareas/* (proxy F2).
 * [por que] Capa fina sobre axios como apiVps.ts; sin cache de modulo (cada
 * carga es fresca: el orden lo decide TASKS y puede cambiar fuera). El error
 * se convierte a mensaje legible con el motivo del puente (503 honesto con
 * motivo, 429 cuota, 404 proyecto) para pintarlo tal cual. */
import axios from 'axios';
import {
  avisoDeRespuesta,
  baseDeEstado,
  columnasDeRespuesta,
  tareaDePuente,
  tareasDeRespuesta,
  type ColumnaTab,
  type ParcheTareaTab,
  type TareaTab,
  type TareasEstado,
  type TareasMovimientoTab,
} from '../../shared/tareas/tareasTab.js';

/* Toda escritura de la tab toca dos sitios (TASK y el roadmap del proyecto, 20AA-10 F3b): el
 * valor que devuelve el proxy y el aviso de lo que le paso al archivo, que puede haber fallado
 * con la tarjeta ya guardada. */
export interface ResultadoEscritura<T> {
  valor: T;
  aviso: string | null;
}

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
      base: baseDeEstado(data.base),
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

/* Columnas fijas (08AA-6): el proxy sincroniza WM->TASKS y devuelve una
 * columna por repo no-ignorado, en orden de snapshot. */
export async function columnasTareas(): Promise<ColumnaTab[]> {
  try {
    const { data } = await axios.get('/api/tareas/proyectos');
    return columnasDeRespuesta(data);
  } catch (err) {
    throw mensajeFallo('columnas de tareas', err);
  }
}

export async function reordenarTareas(movimientos: TareasMovimientoTab[]): Promise<ResultadoEscritura<number>> {
  try {
    const { data } = await axios.post<{ actualizadas?: unknown }>('/api/tareas/reordenar', {
      movimientos,
    });
    /* El proxy devuelve {actualizadas: ItemVersionado[]}; el conteo es su
     * longitud (antes se esperaba number y siempre daba 0). */
    const valor = Array.isArray(data.actualizadas)
      ? data.actualizadas.length
      : typeof data.actualizadas === 'number'
        ? data.actualizadas
        : 0;
    return { valor, aviso: avisoDeRespuesta(data) };
  } catch (err) {
    throw mensajeFallo('reordenar', err);
  }
}

/* Edicion inline (07AA-15): PUT al proxy (upsert F1: actualiza) y normaliza
 * la respuesta igual que proyectoTareas. */
export async function actualizarTarea(legacyId: number, parche: ParcheTareaTab): Promise<ResultadoEscritura<TareaTab>> {
  try {
    const { data } = await axios.put<{ tarea?: unknown }>(`/api/tareas/tarea/${legacyId}`, parche);
    const t = tareaDePuente(data.tarea);
    if (t === null) throw new Error(`actualizar ${legacyId}: respuesta inesperada del servidor`);
    return { valor: t, aviso: avisoDeRespuesta(data) };
  } catch (err) {
    throw mensajeFallo(`actualizar ${legacyId}`, err);
  }
}

/* Borrado (07AA-15): DELETE al proxy (204 F1, idempotente: repetir da 204,
 * nunca 404 — semántica del frente, no del proxy). La columna viaja porque
 * TASK no tiene GET por id: sin ella el proxy no sabe qué línea del roadmap
 * corresponde a la tarjeta (20AA-10 F3b). */
export async function eliminarTarea(columna: number, legacyId: number): Promise<string | null> {
  try {
    const { data } = await axios.delete(`/api/tareas/tarea/${legacyId}`, { params: { columna } });
    return avisoDeRespuesta(data);
  } catch (err) {
    throw mensajeFallo(`eliminar ${legacyId}`, err);
  }
}
