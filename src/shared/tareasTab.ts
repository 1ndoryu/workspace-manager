/* Tipos del proxy /api/tareas/* + puras de la tab kanban (07AA-5 F3).
 * [por que] El front no toca TASKS: habla con el proxy del server F2, que
 * custodia la sesion D1. Formas aqui (no en el componente) para que el
 * contrato sea testeable sin React y la tab solo renderice. Columnas =
 * proyectos TASKS por legacy_id, elegidas por el usuario y persistidas en
 * localStorage (presentacion WM); el orden de las TAREAS vive en TASKS (D2).
 * Límite honesto: sin endpoint de listar-proyectos en F1, no hay
 * descubrimiento: la tab parte de las columnas del seed F1 (9001/9002). */
import { guardarJson, leerJson } from './storage.js';

/* Tarea tal como la sirve GET /api/tareas/proyecto (envoltorio F2 sobre
 * ItemVersionado del nucleo: id + orden + proyecto + campos libres). */
export interface TareaTab {
  legacyId: number;
  orden: number;
  proyectoId?: number;
  campos: Record<string, unknown>;
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
  actualizadas: number;
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

/* Respuesta validada: lo que no sea tarea se descarta (igual que
 * historialSitioVps descarta lo que no sea tupla). */
export function tareasDeRespuesta(datos: unknown): TareaTab[] {
  if (typeof datos !== 'object' || datos === null) return [];
  const lista = (datos as { tareas?: unknown }).tareas;
  if (!Array.isArray(lista)) return [];
  return lista.filter(esTareaTab);
}

/* Texto visible de la fila: primer campo textual conocido; sin texto,
 * el id (nunca celda vacia). */
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
