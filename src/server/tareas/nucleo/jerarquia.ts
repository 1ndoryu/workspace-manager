/* PIN tasks-core@ba7dfd4 (PROYECTO TASKS, 07AA-1 F1b v0.1.0).
 * [por que] Ver `tipos.ts`: snapshot vendorizado, no editar a mano.
 * Consultas puras sobre árboles de tareas de un solo nivel (padre → hijas).
 * Las reglas de arrastre con lógica de producto (p. ej. hábitos) siguen en el editor. */

export interface NodoArbol {
    id: number;
    parentId?: number | null;
    orden?: number;
    completado?: boolean;
}

export function obtenerSubtareas<T extends NodoArbol>(tareas: T[], padreId: number): T[] {
    return tareas.filter((tarea) => tarea.parentId === padreId).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

export function obtenerPadre<T extends NodoArbol>(tareas: T[], tarea: T): T | undefined {
    if (tarea.parentId == null) {
        return undefined;
    }
    return tareas.find((t) => t.id === tarea.parentId);
}

export function tieneSubtareas<T extends NodoArbol>(tareas: T[], tareaId: number): boolean {
    return tareas.some((tarea) => tarea.parentId === tareaId);
}

export function contarSubtareas<T extends NodoArbol>(tareas: T[], tareaId: number): {total: number; completadas: number} {
    const subtareas = tareas.filter((tarea) => tarea.parentId === tareaId);
    return {total: subtareas.length, completadas: subtareas.filter((tarea) => tarea.completado === true).length};
}

export function esDescendiente<T extends NodoArbol>(tareas: T[], tareaId: number, posibleAncestroId: number): boolean {
    let actual = tareas.find((t) => t.id === tareaId);
    while (actual?.parentId != null) {
        if (actual.parentId === posibleAncestroId) {
            return true;
        }
        actual = tareas.find((t) => t.id === actual?.parentId);
    }
    return false;
}

export function esTareaPadre<T extends NodoArbol>(tareas: T[], tareaId: number): boolean {
    return tieneSubtareas(tareas, tareaId);
}

export function esSubtarea<T extends NodoArbol>(tarea: T): boolean {
    return tarea.parentId != null;
}

export function obtenerTareasPrincipales<T extends NodoArbol>(tareas: T[]): T[] {
    return tareas.filter((tarea) => tarea.parentId == null).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

export function obtenerIndiceTarea<T extends NodoArbol>(tareas: T[], tareaId: number): number {
    return tareas.findIndex((t) => t.id === tareaId);
}

export function obtenerTareaAnterior<T extends NodoArbol>(tareas: T[], tareaId: number): T | undefined {
    const indice = obtenerIndiceTarea(tareas, tareaId);
    return indice > 0 ? tareas[indice - 1] : undefined;
}

export function ordenarConJerarquia<T extends NodoArbol>(tareas: T[]): T[] {
    const principales = obtenerTareasPrincipales(tareas);
    return principales.flatMap((padre) => [padre, ...obtenerSubtareas(tareas, padre.id)]);
}

export function asignarOrden<T extends NodoArbol>(tareas: T[]): T[] {
    return tareas.map((tarea, indice) => ({...tarea, orden: indice}));
}
