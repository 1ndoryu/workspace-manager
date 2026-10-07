/* PIN tasks-core@ba7dfd4 (PROYECTO TASKS, 07AA-1 F1b v0.1.0).
 * [por que] Ver `tipos.ts`: snapshot vendorizado, no editar a mano. */
import type {BulkReorderRequest} from './tipos.js';

/* Tope del bulk transaccional (el servidor rechaza lotes mayores). */
export const TOPE_BULK = 200;
export const MINIMO_BULK = 1;
const MAX_ENTERO_32 = 2147483647;
const MIN_ENTERO_32 = -2147483648;

export function esIdValido(id: unknown): id is number {
    return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

export function esOrdenValido(orden: unknown): orden is number {
    return typeof orden === 'number'
        && Number.isInteger(orden)
        && orden >= MIN_ENTERO_32
        && orden <= MAX_ENTERO_32;
}

export function validarMovimiento(movimiento: unknown, indice: number): string[] {
    if (typeof movimiento !== 'object' || movimiento === null) {
        return [`movimientos[${indice}] debe ser un objeto`];
    }
    const {legacyId, orden, proyectoId} = movimiento as Record<string, unknown>;
    const errores: string[] = [];
    if (!esIdValido(legacyId)) {
        errores.push(`movimientos[${indice}].legacyId debe ser un entero positivo`);
    }
    if (!esOrdenValido(orden)) {
        errores.push(`movimientos[${indice}].orden debe ser un entero de 32 bits`);
    }
    if (proyectoId !== undefined && !esIdValido(proyectoId)) {
        errores.push(`movimientos[${indice}].proyectoId debe ser un entero positivo`);
    }
    return errores;
}

export type ResultadoValidacionLote =
    | {ok: true; lote: BulkReorderRequest}
    | {ok: false; errores: string[]};

export function validarLote(movimientos: unknown): ResultadoValidacionLote {
    if (!Array.isArray(movimientos)) {
        return {ok: false, errores: ['movimientos debe ser un array']};
    }
    if (movimientos.length < MINIMO_BULK || movimientos.length > TOPE_BULK) {
        return {ok: false, errores: [`movimientos debe traer entre ${MINIMO_BULK} y ${TOPE_BULK} elementos`]};
    }
    const errores = movimientos.flatMap((movimiento, indice) => validarMovimiento(movimiento, indice));
    if (errores.length > 0) {
        return {ok: false, errores};
    }
    return {ok: true, lote: {movimientos: movimientos as BulkReorderRequest['movimientos']}};
}
