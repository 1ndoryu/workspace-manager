/* Tipos del proxy /api/tareas/* + puras de la tab kanban (07AA-5 F3).
 * [por que] El front no toca TASKS: habla con el proxy del server F2, que
 * custodia la sesion D1. Formas aqui (no en el componente) para que el
 * contrato sea testeable sin React y la tab solo renderice. Columnas =
 * proyectos TASKS por legacy_id, elegidas por el usuario y persistidas en
 * localStorage (presentacion WM); el orden de las TAREAS vive en TASKS (D2).
 * Límite honesto: sin endpoint de listar-proyectos en F1, no hay
 * descubrimiento: la tab parte de las columnas del seed F1 (9001/9002). */
import { guardarJson, leerJson } from './storage.js';

/* Tarea normalizada para la tab (la que pintan las columnas). */
export interface TareaTab {
  legacyId: number;
  orden: number;
  proyectoId?: number;
  campos: Record<string, unknown>;
}

/* Item tal como lo sirve GET /api/tareas/proyecto (envoltorio F2 sobre
 * ItemVersionado del nucleo tasks-core: id + item + updatedAt). La tab
 * nunca ve esta forma: tareasDeRespuesta la normaliza a TareaTab. */
export interface TareaPuente {
  id: unknown;
  item: unknown;
  updatedAt?: unknown;
}

export interface TareasProyectoRespuesta {
  tareas: TareaTab[];
}

export interface TareasMovimientoTab {
  legacyId: number;
  orden: number;
  proyectoId?: number;
}

export interface TareasReordenarRespuesta {
  actualizadas: unknown;
}

/* GET /api/tareas/estado: el puente dice si puede operar y por que no. */
export interface TareasEstado {
  configurado: boolean;
  disponible: boolean;
  motivo: string | null;
}

export function esTareaTab(v: unknown): v is TareaTab {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    Number.isInteger(t.legacyId) &&
    Number.isInteger(t.orden) &&
    typeof t.campos === 'object' &&
    t.campos !== null
  );
}

/* Normaliza un item del puente a TareaTab (null si no es item valido).
 * [por que] El proxy sirve {id, item:{orden, proyectoId, texto, ...}} y la
 * tab trabaja con {legacyId, orden, proyectoId, campos}: sin esta
 * normalizacion el filtro de esTareaTab descarta el 100% (bug 2026-10-07:
 * las columnas salian siempre vacias aunque el proxy trajera tareas). */
export function tareaDePuente(v: unknown): TareaTab | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  if (!Number.isInteger(p.id)) return null;
  if (typeof p.item !== 'object' || p.item === null) return null;
  const item = p.item as Record<string, unknown>;
  if (!Number.isInteger(item.orden)) return null;
  const t: TareaTab = {
    legacyId: p.id as number,
    orden: item.orden as number,
    campos: item as Record<string, unknown>,
  };
  if (Number.isInteger(item.proyectoId)) t.proyectoId = item.proyectoId as number;
  return t;
}

/* Respuesta validada: normaliza cada item del puente y descarta lo que no
 * sea tarea (igual que historialSitioVps descarta lo que no sea tupla). */
export function tareasDeRespuesta(datos: unknown): TareaTab[] {
  if (typeof datos !== 'object' || datos === null) return [];
  const lista = (datos as { tareas?: unknown }).tareas;
  if (!Array.isArray(lista)) return [];
  const normalizadas: TareaTab[] = [];
  for (const v of lista) {
    const t = tareaDePuente(v);
    if (t !== null) normalizadas.push(t);
  }
  return normalizadas;
}

/* Parche de edicion inline (07AA-15): espejo del body de PUT
 * /api/tareas/tarea/:id (el proxy revalida con validarParche; TASKS
 * revalida con UpsertTaskRequest). `texto` siempre va (F1 lo exige). */
export interface ParcheTareaTab {
  texto: string;
  completado?: boolean;
  prioridad?: string | null;
  urgencia?: string;
  proyectoId?: number | null;
  orden?: number;
}

/* El PUT F1 es upsert de reemplazo: sin proyectoId TASKS lo pone a null
 * y la tarjeta se vuelve huerfana invisible (bug 2026-10-07: completar
 * desde el menu "borraba" la tarjeta). El hook inyecta su columna con
 * esta pura para que el invariante quede cubierto por test. */
export function parcheConColumna(columna: number, parche: ParcheTareaTab): ParcheTareaTab {
  return {...parche, proyectoId: columna};
}

/* Vocabulario de niveles (07AA-15): espejo exacto de TASKS
 * frontend/src/app/utils/constantes.ts (OPCIONES_PRIORIDAD/URGENCIA) y
 * types/tarea.ts (NivelPrioridad/NivelUrgencia). El proxy solo acepta
 * estos ids (validarParche) y TASKS los valida en dataService.ts:351-355:
 * inventar uno nuevo daria 422 en el frente. */
export const PRIORIDADES_TAREA = ['muy_alta', 'alta', 'media', 'baja', 'muy_baja'] as const;
export const URGENCIAS_TAREA = ['bloqueante', 'urgente', 'normal', 'chill'] as const;

export const ETIQUETAS_PRIORIDAD: Record<string, string> = {
  muy_alta: 'Muy Alta',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
  muy_baja: 'Muy Baja',
};

export const ETIQUETAS_URGENCIA: Record<string, string> = {
  bloqueante: 'Bloqueante',
  urgente: 'Urgente',
  normal: 'Normal',
  chill: 'Chill',
};

/* Lecturas honestas de los campos (campos es Record<string, unknown>):
 * lo ausente o roto cae al defecto, nunca rompe el render. */
export function completadoTarea(t: TareaTab): boolean {
  return t.campos.completado === true;
}

export function prioridadTarea(t: TareaTab): string | null {
  const v = t.campos.prioridad;
  return typeof v === 'string' && (PRIORIDADES_TAREA as readonly string[]).includes(v) ? v : null;
}

export function urgenciaTarea(t: TareaTab): string {
  const v = t.campos.urgencia;
  return typeof v === 'string' && (URGENCIAS_TAREA as readonly string[]).includes(v) ? v : 'normal';
}
export function textoTarea(t: TareaTab): string {
  for (const k of ['texto', 'titulo', 'nombre', 'name']) {
    const v = t.campos[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return `#${t.legacyId}`;
}

/* Orden nuevo de una columna como movimientos bulk (orden = posicion). */
export function construirMovimientos(
  ordenados: { legacyId: number }[],
  proyectoId: number,
): TareasMovimientoTab[] {
  return ordenados.map((t, i) => ({ legacyId: t.legacyId, orden: i, proyectoId }));
}

/* Entrada manual de columna: entero positivo o nada. */
export function parsearLegacyId(texto: string): number | null {
  const n = Number(texto.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* Columnas vistas en la tab, persistidas en localStorage (presentacion WM:
 * anadir/quitar/reordenar columnas no toca TASKS). Defecto = seed F1. */
export const COLUMNAS_DEFECTO_TAREAS = [9001, 9002];
const CLAVE_COLUMNAS_TAREAS = 'workspaceManager:tareas:columnas';

export function normalizarColumnas(v: unknown): number[] {
  if (!Array.isArray(v)) return [...COLUMNAS_DEFECTO_TAREAS];
  const ids: number[] = [];
  for (const x of v) {
    if (Number.isInteger(x) && (x as number) > 0 && !ids.includes(x as number)) ids.push(x as number);
  }
  return ids.length > 0 ? ids : [...COLUMNAS_DEFECTO_TAREAS];
}

export function leerColumnasTareas(): number[] {
  return normalizarColumnas(leerJson(CLAVE_COLUMNAS_TAREAS, 'no se pudieron leer las columnas de tareas:'));
}

export function guardarColumnasTareas(columnas: number[]): void {
  guardarJson(CLAVE_COLUMNAS_TAREAS, columnas, 'no se pudieron guardar las columnas de tareas:');
}
