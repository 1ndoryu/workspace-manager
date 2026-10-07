/* Operaciones unitarias sobre una tarea (07AA-15): parche de edicion y mapa
 * de errores PUT/DELETE, sin sesion (puras: testeables sin red ni login).
 * [por que] Nacio al partir `puente-tareas.ts` (limite-lineas 300): lo puro
 * vive aqui; la sesion D1, el lock de re-login y la cuota siguen en el puente. */
import type {ErrorKanban} from './nucleo/tipos.js';

/* Parche de edición inline de la tab (07AA-15): subconjunto del
 * UpsertTaskRequest F1 (vocabulario espejo; TASKS revalida con 422).
 * `texto` es requerido por F1: el front lo manda siempre (lo conoce).
 * `proyectoId` viaja siempre (el PUT F1 es upsert de reemplazo: sin el,
 * TASKS lo pone a null y la tarjeta se vuelve huerfana invisible). */
export interface ParcheTarea {
  texto: string;
  completado?: boolean;
  prioridad?: string | null;
  urgencia?: string;
  proyectoId?: number | null;
  parentId?: number | null;
  orden?: number;
}

const PRIORIDADES_OK = ['muy_alta', 'alta', 'media', 'baja', 'muy_baja'];
const URGENCIAS_OK = ['bloqueante', 'urgente', 'normal', 'chill'];

export function validarParche(parche: unknown): {ok: true; valor: ParcheTarea} | {ok: false; errores: string[]} {
  const errores: string[] = [];
  if (typeof parche !== 'object' || parche === null) return {ok: false, errores: ['parche-vacio']};
  const p = parche as Record<string, unknown>;
  if (typeof p.texto !== 'string' || p.texto.trim() === '' || p.texto.length > 1000) {
    errores.push('texto-requerido-max-1000');
  }
  if (p.completado !== undefined && typeof p.completado !== 'boolean') errores.push('completado-bool');
  if (p.prioridad !== undefined && p.prioridad !== null && !PRIORIDADES_OK.includes(String(p.prioridad))) {
    errores.push('prioridad-invalida');
  }
  if (p.urgencia !== undefined && !URGENCIAS_OK.includes(String(p.urgencia))) errores.push('urgencia-invalida');
  for (const k of ['proyectoId', 'parentId', 'orden'] as const) {
    if (p[k] !== undefined && p[k] !== null && !Number.isInteger(p[k])) errores.push(`${k}-entero`);
  }
  if (errores.length > 0) return {ok: false, errores};
  return {ok: true, valor: p as unknown as ParcheTarea};
}

/* Mapa de errores PUT/DELETE sobre /api/tasks/:legacy_id: el mismo
 * vocabulario ErrorKanban para que las rutas respondan igual que el resto. */
export function mapearErrorTarea(estado: number, cuerpo: unknown, reintentar?: number): ErrorKanban {
  const mensaje =
    typeof cuerpo === 'object' && cuerpo !== null && typeof (cuerpo as {message?: unknown}).message === 'string'
      ? (cuerpo as {message: string}).message
      : 'Error de TASKS';
  if (estado === 401) return {codigo: 'no-autenticado', mensaje, estadoHttp: estado};
  if (estado === 404) return {codigo: 'no-encontrado', mensaje, estadoHttp: estado};
  if (estado === 422) return {codigo: 'validacion', mensaje, estadoHttp: estado};
  if (estado === 429) {
    return {codigo: 'cuota', mensaje, estadoHttp: estado, reintentarEnMs: reintentar};
  }
  return {codigo: 'servidor', mensaje, estadoHttp: estado};
}
