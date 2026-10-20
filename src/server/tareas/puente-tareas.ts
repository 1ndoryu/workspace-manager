/* Puente con proyecto-ejemplo para la tab tareas (07AA-5 F2).
 * [por que] Patron pulse (`vps/puente.ts`): el front nunca habla con TASKS
 * (D1); este modulo custodia la sesion admin local (cookie `session_id` +
 * CSRF `csrf_token`, solo en el servidor, credenciales en env gitignored) y
 * expone `disponible/motivo` honestos. Re-login con lock ante 401 (una sola
 * entrada aunque caduque en rafaga); backoff con jitter y tope ante 429; el
 * breaker se abre ante red/login-roto y deja pasar un intento tras el
 * enfriamiento. Transporte inyectable: los tests no tocan red. */
import {esIdValido} from './nucleo/validaciones.js';
import type {BulkReorderRequest, ErrorKanban, ItemVersionado} from './nucleo/tipos.js';
import {crearHttpNativo} from './transporte/transporte-tareas.js';
import type {ParcheTarea, ProyectoPuente} from './tarea-unitaria.js';
import {configPuenteViva, type ConfigPuente} from './entorno/config-puente.js';
/* Piezas puras y de sesion del puente, en subcarpeta (límite de 300 líneas). */
import {errorIdInvalido, motivoSinConfig} from './puente-tareas/errores.js';
import {crearNucleoSesion} from './puente-tareas/nucleo-sesion.js';
import {crearApiPuente} from './puente-tareas/api.js';

export type {FetchPuente, RespuestaPuente} from './transporte/transporte-tipos.js';
import type {FetchPuente} from './transporte/transporte-tipos.js';

  /* Transporte de produccion: HTTP nativo (el fetch global bloquea el
   * puerto 4190 por Fetch-spec: `bad port` sin tocar red; ver
   * `transporte-tareas.ts`). Se conserva `crearFetchGlobal` para inyeccion. */
export function crearFetchGlobal(timeoutMs: number): FetchPuente {
  return async (url, init) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: ctrl.signal,
      });
      const cabezas = r.headers as Headers & {getSetCookie?: () => string[]};
      return {
        ok: r.ok,
        estado: r.status,
        cabeceras: {obtener: (nombre) => r.headers.get(nombre)},
        json: () => r.json() as Promise<unknown>,
        /* getSetCookie vive en Headers, no en Response: sin el las dos
         * cookies llegan pegadas en un solo `get('set-cookie')` y la
         * sesion D1 nunca se establece (F2 e2e lo midio). */
        cookies: typeof cabezas.getSetCookie === 'function' ? cabezas.getSetCookie() : [],
      };
    } finally {
      clearTimeout(t);
    }
  };
}

export interface DepsPuente {
  config?: ConfigPuente;
  transporte?: FetchPuente;
  dormir?: (ms: number) => Promise<void>;
  azar?: () => number;
  ahora?: () => number;
}

export interface EstadoPuente {
  disponible: boolean;
  motivo: string | null;
  base: string;
  conCredenciales: boolean;
}

export interface PuenteTareas {
  estado(): EstadoPuente;
  listar(legacyId: number): Promise<ItemVersionado[]>;
  proyectos(): Promise<ProyectoPuente[]>;
  crearProyecto(legacyId: number, nombre: string, wmClave: string): Promise<number>;
  reordenar(lote: BulkReorderRequest): Promise<ItemVersionado[]>;
  actualizar(legacyId: number, parche: ParcheTarea): Promise<ItemVersionado>;
  eliminar(legacyId: number): Promise<void>;
}

/* Compone sesion (nucleo-sesion.ts) y llamadas (api.ts): aqui solo se decide
 * que operacion pasa por el breaker y cual valida el id antes de gastar sesion. */
export function crearPuenteTareas(deps: DepsPuente = {}): PuenteTareas {
  const configFija = deps.config;
  const cfg = (): ConfigPuente => configFija ?? configPuenteViva();
  const transporte = deps.transporte ?? crearHttpNativo(cfg().timeoutMs);
  const dormir = deps.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const azar = deps.azar ?? Math.random;
  const ahora = deps.ahora ?? Date.now;

  const nucleo = crearNucleoSesion({cfg, transporte, dormir, azar, ahora});
  const api = crearApiPuente(cfg, nucleo);
  const {operar} = nucleo;
  const conCredenciales = (): boolean => cfg().email !== '' && cfg().password !== '';

  return {
    estado(): EstadoPuente {
      const sinConfig = motivoSinConfig(cfg());
      if (sinConfig !== null) return {disponible: false, motivo: sinConfig, base: cfg().base, conCredenciales: conCredenciales()};
      const vigente = nucleo.motivoFallaVigente();
      if (vigente !== null) return {disponible: false, motivo: vigente, base: cfg().base, conCredenciales: true};
      return {disponible: true, motivo: null, base: cfg().base, conCredenciales: true};
    },
    listar: (legacyId) => operar(() => api.cliente().listarTareasProyecto(legacyId)),
    proyectos: () => operar(api.pedirProyectos),
    /* Crea el proyecto TASKS espejo de un repo WM (08AA-6 sync): upsert por
     * id generado + `payload.wmClave` como llave de emparejado futuro. Sin
     * `estado` (TASKS lo deja en `activo` por defecto). Devuelve el id. */
    crearProyecto: (legacyId, nombre, wmClave) => {
      /* Valida antes de operar (sin gastar sesion en un id imposible). */
      if (!esIdValido(legacyId)) {
        return Promise.reject(errorIdInvalido());
      }
      return operar(async () => {
        await api.pedirApi('projects', 'PUT', legacyId, {nombre, payload: {wmClave}});
        return legacyId;
      });
    },
    reordenar: (lote) => operar(() => api.cliente().reordenarBulk(lote)),
    actualizar: (legacyId, parche) =>
      operar(async () => {
        if (!esIdValido(legacyId)) {
          throw errorIdInvalido();
        }
        const datos = await api.pedirApi('tasks', 'PUT', legacyId, {...(await api.conLoGuardado(legacyId, parche))});
        if (typeof datos !== 'object' || datos === null || typeof (datos as {id?: unknown}).id !== 'number') {
          throw {codigo: 'servidor', mensaje: 'Respuesta inesperada del servidor'} satisfies ErrorKanban;
        }
        return datos as ItemVersionado;
      }),
    eliminar: (legacyId) =>
      operar(async () => {
        if (!esIdValido(legacyId)) {
          throw errorIdInvalido();
        }
        await api.pedirApi('tasks', 'DELETE', legacyId);
      }),
  };
}

/* Puente de producción (env del proceso; el front jamás ve las credenciales). */
export const puenteTareas = crearPuenteTareas();
