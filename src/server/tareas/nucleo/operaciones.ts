/* PIN tasks-core@ba7dfd4 (PROYECTO TASKS, 07AA-1 F1b v0.1.0).
 * [por que] Ver `tipos.ts`: snapshot vendorizado, no editar a mano.
 * Operaciones puras del kanban: construcción del bulk, fusión de listas
 * reordenadas y merge del orden bajo `preferencias.kanban.v1` (envelope `{valor,ts}`).
 * Sin red, sin stores: el editor aporta el transporte y la persistencia. */
import type {OrdenKanban, ReordenarMovimiento} from './tipos.js';

/* Clave de preferencias donde vive el orden del kanban. */
export const CLAVE_KANBAN_V1 = 'kanban.v1';

/* Construye los movimientos del bulk: el orden es la posición en la lista. */
export function construirMovimientosBulk<T extends {id: number}>(lista: T[], proyectoDestino?: number): ReordenarMovimiento[] {
    return lista.map((tarea, indice) => (proyectoDestino === undefined
        ? {legacyId: tarea.id, orden: indice}
        : {legacyId: tarea.id, orden: indice, proyectoId: proyectoDestino}));
}

/*
 * Fusión de listas reordenadas: conserva las no afectadas en su posición y
 * reasigna el orden al resultado. Lógica extraída de `useTareaReordenar`;
 * el hook conserva la parte con stores y reglas de producto (p. ej. hábitos virtuales).
 */
export function reordenarLista<T extends {id: number}>(previas: T[], reordenadas: T[], esVirtual?: (tarea: T) => boolean): T[] {
    const idsReordenados = new Set(reordenadas.map((tarea) => tarea.id));
    const noAfectadas = previas.filter((tarea) => !idsReordenados.has(tarea.id));
    const reales = esVirtual === undefined ? reordenadas : reordenadas.filter((tarea) => !esVirtual(tarea));
    return [...noAfectadas, ...reales].map((tarea, indice) => ({...tarea, orden: indice}));
}

/* Lee el orden del kanban desde el blob de preferencias (null si no hay o está roto). */
export function leerOrdenKanbanDesdePreferencias(preferencias: unknown): OrdenKanban | null {
    if (typeof preferencias !== 'object' || preferencias === null) {
        return null;
    }
    const envelope = (preferencias as Record<string, unknown>)[CLAVE_KANBAN_V1];
    if (typeof envelope !== 'object' || envelope === null) {
        return null;
    }
    const valor = (envelope as {valor?: unknown}).valor;
    if (typeof valor !== 'object' || valor === null) {
        return null;
    }
    const {ordenColumnas, ordenTareas} = valor as Record<string, unknown>;
    if (!Array.isArray(ordenColumnas) || !ordenColumnas.every((id) => typeof id === 'number')) {
        return null;
    }
    if (typeof ordenTareas !== 'object' || ordenTareas === null) {
        return null;
    }
    return {ordenColumnas, ordenTareas: ordenTareas as Record<string, number[]>};
}

/* Mezcla el orden bajo la clave sin tocar el resto de preferencias. */
export function mezclarPreferenciasKanban(base: unknown, orden: OrdenKanban, ahoraIso?: string): Record<string, unknown> {
    const resto = typeof base === 'object' && base !== null ? {...(base as Record<string, unknown>)} : {};
    return {...resto, [CLAVE_KANBAN_V1]: {valor: orden, ts: ahoraIso ?? new Date().toISOString()}};
}
