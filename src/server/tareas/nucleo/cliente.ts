/* PIN tasks-core@ba7dfd4 (PROYECTO TASKS, 07AA-1 F1b v0.1.0).
 * [por que] Ver `tipos.ts`: snapshot vendorizado, no editar a mano.
 * Cliente fino de los endpoints F1 (07AA-1) con fetch inyectado: funciona en
 * navegador, Node 18+ o tests con un doble. Sin estado, sin stores, sin UI.
 * Los métodos rechazan con `ErrorKanban` (nunca lanzan `Error` genérico). */
import type {
    BulkReorderRequest,
    ErrorKanban,
    FetchFn,
    ItemVersionado,
    RespuestaHttp,
} from './tipos.js';
import {esIdValido, validarLote} from './validaciones.js';

export const CABECERA_CSRF = 'x-csrf-token';
export const rutaTareasProyecto = (legacyId: number): string => `/api/projects/${legacyId}/tasks`;
export const RUTA_REORDENAR = '/api/tasks/reordenar';

export interface OpcionesCliente {
    base?: string;
    fetchFn: FetchFn;
    leerCsrf?: () => string | null;
}

export interface ClienteKanban {
    listarTareasProyecto(legacyId: number): Promise<ItemVersionado[]>;
    reordenarBulk(lote: BulkReorderRequest): Promise<ItemVersionado[]>;
}

/* Forma estructural del fetch global (navegador/Node): sin tipos del DOM. */
export interface RespuestaCompatible {
    ok: boolean;
    status: number;
    headers: {get(nombre: string): string | null};
    json(): Promise<unknown>;
}

/* Adapta el fetch global a la forma mínima del núcleo. */
export function adaptarRespuestaFetch(respuesta: RespuestaCompatible): RespuestaHttp {
    return {
        ok: respuesta.ok,
        estado: respuesta.status,
        cabeceras: {obtener: (nombre) => respuesta.headers.get(nombre)},
        json: () => respuesta.json(),
    };
}

function leerMensajeServidor(cuerpo: unknown, defecto: string): string {
    if (typeof cuerpo === 'object' && cuerpo !== null
        && typeof (cuerpo as Record<string, unknown>).message === 'string') {
        return (cuerpo as {message: string}).message;
    }
    return defecto;
}

function esListaVersionada(valor: unknown): valor is ItemVersionado[] {
    return Array.isArray(valor) && valor.every((elemento) =>
        typeof elemento === 'object' && elemento !== null
        && typeof (elemento as {id?: unknown}).id === 'number');
}

function mapearError(estado: number, cuerpo: unknown, reintentarEnMs?: number): ErrorKanban {
    if (estado === 401) {
        return {codigo: 'no-autenticado', mensaje: leerMensajeServidor(cuerpo, 'Sesión caducada'), estadoHttp: estado};
    }
    if (estado === 404) {
        return {codigo: 'no-encontrado', mensaje: leerMensajeServidor(cuerpo, 'Proyecto no encontrado'), estadoHttp: estado};
    }
    if (estado === 409) {
        return {codigo: 'lote-duplicado', mensaje: leerMensajeServidor(cuerpo, 'El lote trae tareas duplicadas'), estadoHttp: estado};
    }
    if (estado === 422) {
        return {codigo: 'validacion', mensaje: leerMensajeServidor(cuerpo, 'Lote inválido'), estadoHttp: estado};
    }
    if (estado === 429) {
        return {codigo: 'cuota', mensaje: leerMensajeServidor(cuerpo, 'Cuota de escritura agotada'), estadoHttp: estado, reintentarEnMs};
    }
    return {codigo: 'servidor', mensaje: leerMensajeServidor(cuerpo, 'Error del servidor'), estadoHttp: estado};
}

function leerReintentoMs(cabecera: string | null): number | undefined {
    if (cabecera === null) {
        return undefined;
    }
    const segundos = Number(cabecera);
    return Number.isFinite(segundos) && segundos >= 0 ? segundos * 1000 : undefined;
}

export function crearClienteKanban(opciones: OpcionesCliente): ClienteKanban {
    const base = opciones.base ?? '';

    async function pedir<T>(ruta: string, cuerpo: unknown, esLista: (valor: unknown) => valor is T[]): Promise<T[]> {
        const csrf = opciones.leerCsrf?.() ?? null;
        let respuesta: RespuestaHttp;
        try {
            respuesta = await opciones.fetchFn(`${base}${ruta}`, {
                method: cuerpo === undefined ? 'GET' : 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(csrf === null ? {} : {[CABECERA_CSRF]: csrf}),
                },
                body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            });
        } catch {
            throw {codigo: 'red', mensaje: 'Error de red'} satisfies ErrorKanban;
        }
        let datos: unknown = null;
        try {
            datos = await respuesta.json();
        } catch {
            datos = null;
        }
        if (!respuesta.ok) {
            throw mapearError(respuesta.estado, datos, leerReintentoMs(respuesta.cabeceras.obtener('retry-after')));
        }
        const lista = (datos as {tareas?: unknown; actualizadas?: unknown}).tareas
            ?? (datos as {actualizadas?: unknown}).actualizadas;
        if (!esLista(lista)) {
            throw {codigo: 'servidor', mensaje: 'Respuesta inesperada del servidor', estadoHttp: respuesta.estado} satisfies ErrorKanban;
        }
        return lista;
    }

    return {
        async listarTareasProyecto(legacyId: number): Promise<ItemVersionado[]> {
            if (!esIdValido(legacyId)) {
                throw {codigo: 'validacion', mensaje: 'legacyId debe ser un entero positivo'} satisfies ErrorKanban;
            }
            return pedir<ItemVersionado>(
                rutaTareasProyecto(legacyId), undefined, esListaVersionada,
            );
        },
        async reordenarBulk(lote: BulkReorderRequest): Promise<ItemVersionado[]> {
            const validado = validarLote(lote.movimientos);
            if (!validado.ok) {
                throw {codigo: 'validacion', mensaje: validado.errores.join('; ')} satisfies ErrorKanban;
            }
            return pedir<ItemVersionado>(
                RUTA_REORDENAR, validado.lote, esListaVersionada,
            );
        },
    };
}
