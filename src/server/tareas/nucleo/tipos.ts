/* PIN tasks-core@ba7dfd4 (PROYECTO TASKS, 07AA-1 F1b v0.1.0).
 * [por que] Snapshot vendorizado: npm no instala subdirectorios por tag y
 * `file:` rompe en OneDrive (EPERM F0). NO editar a mano: re-vendorizar desde
 * el commit pin y actualizar `PIN.md`. Unica adaptacion mecanica: imports con
 * sufijo `.js` (lo exige `tsconfig.server.json`). */

export interface TareaNucleo {
    id: number;
    texto?: string;
    completado?: boolean;
    orden?: number;
    proyectoId?: number | null;
    parentId?: number | null;
}

export interface ProyectoNucleo {
    legacyId: number;
    nombre: string;
    orden?: number;
}

/* Movimiento de reorden: espejo de `ReordenarMovimiento` (backend). */
export interface ReordenarMovimiento {
    legacyId: number;
    orden: number;
    proyectoId?: number;
}

export interface BulkReorderRequest {
    movimientos: ReordenarMovimiento[];
}

/* Item versionado tal como lo devuelve la API (`{id, item, updatedAt}`). */
export interface ItemVersionado {
    id: number;
    item: Record<string, unknown>;
    updatedAt: string;
}

export interface ProjectTasksResponse {
    tareas: ItemVersionado[];
}

export interface BulkReorderResponse {
    actualizadas: ItemVersionado[];
}

/* Orden del kanban persistido bajo `preferencias.kanban.v1` (envelope `{valor,ts}`). */
export interface OrdenKanban {
    ordenColumnas: number[];
    ordenTareas: Record<string, number[]>;
}

export interface EnvelopeKanban<T> {
    valor: T;
    ts: string;
}

export type CodigoErrorKanban =
    | 'no-autenticado'
    | 'no-encontrado'
    | 'validacion'
    | 'lote-duplicado'
    | 'cuota'
    | 'red'
    | 'servidor';

export interface ErrorKanban {
    codigo: CodigoErrorKanban;
    mensaje: string;
    estadoHttp?: number;
    reintentarEnMs?: number;
}

/* Petición mínima: el cliente acepta el fetch global o un doble de test. */
export interface PeticionHttp {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

export interface CabecerasHttp {
    obtener(nombre: string): string | null;
}

export interface RespuestaHttp {
    ok: boolean;
    estado: number;
    cabeceras: CabecerasHttp;
    json(): Promise<unknown>;
}

export type FetchFn = (url: string, init: PeticionHttp) => Promise<RespuestaHttp>;
