/* Puente con proyecto-ejemplo para la tab tareas (07AA-5 F2).
 * [por que] Patron pulse (`vps/puente.ts`): el front nunca habla con TASKS
 * (D1); este modulo custodia la sesion admin local (cookie `session_id` +
 * CSRF `csrf_token`, solo en el servidor, credenciales en env gitignored) y
 * expone `disponible/motivo` honestos. Re-login con lock ante 401 (una sola
 * entrada aunque caduque en rafaga); backoff con jitter y tope ante 429; el
 * breaker se abre ante red/login-roto y deja pasar un intento tras el
 * enfriamiento. Transporte inyectable: los tests no tocan red. */
import {crearClienteKanban, CABECERA_CSRF, type ClienteKanban} from './nucleo/cliente.js';
import {esIdValido} from './nucleo/validaciones.js';
import type {
  BulkReorderRequest,
  ErrorKanban,
  ItemVersionado,
  PeticionHttp,
  RespuestaHttp,
} from './nucleo/tipos.js';
import {crearHttpNativo} from './transporte/transporte-tareas.js';
import {pedirProyectosPuente} from './proyectos-puente.js';
import {mapearErrorTarea, type ParcheTarea, type ProyectoPuente} from './tarea-unitaria.js';
import {completarParche} from './escritura/parche-completo.js';
import {configPuenteViva, type ConfigPuente} from './entorno/config-puente.js';

const RUTA_LOGIN = '/api/auth/login';
const COOKIE_SESION = 'session_id';
const COOKIE_CSRF = 'csrf_token';
const VALOR_COOKIE_OK = /^[A-Za-z0-9._-]{1,256}$/;
const TOPE_ESPERA_CUOTA_MS = 30_000;

export type {FetchPuente, RespuestaPuente} from './transporte/transporte-tipos.js';
import type {FetchPuente, RespuestaPuente} from './transporte/transporte-tipos.js';

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

interface Sesion {
  sessionId: string;
  csrf: string;
}

function extraerCookie(cookies: string[], nombre: string): string | null {
  for (const c of cookies) {
    const par = (c.split(';', 1)[0] ?? '').trim();
    const eq = par.indexOf('=');
    if (eq > 0 && par.slice(0, eq).trim() === nombre) {
      const valor = par.slice(eq + 1).trim();
      if (VALOR_COOKIE_OK.test(valor)) return valor;
    }
  }
  return null;
}

function esKanban(e: unknown, codigo: ErrorKanban['codigo']): boolean {
  return typeof e === 'object' && e !== null && (e as {codigo?: unknown}).codigo === codigo;
}

function mensajeDe(e: unknown, defecto: string): string {
  const m = (e as {mensaje?: unknown} | null)?.mensaje;
  return typeof m === 'string' && m ? m.slice(0, 200) : defecto;
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

export function crearPuenteTareas(deps: DepsPuente = {}): PuenteTareas {
  const configFija = deps.config;
  const cfg = (): ConfigPuente => configFija ?? configPuenteViva();
  const transporte = deps.transporte ?? crearHttpNativo(cfg().timeoutMs);
  const dormir = deps.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const azar = deps.azar ?? Math.random;
  const ahora = deps.ahora ?? Date.now;

  let sesion: Sesion | null = null;
  /* Lock del re-login (D1): una sola entrada en vuelo aunque N llamadas vean
   * 401 a la vez; el resto espera la misma promesa. */
  let accesoLogin: Promise<Sesion> | null = null;
  let ultimaFalla = 0;
  let motivoFalla: string | null = null;

  const conCredenciales = (): boolean => cfg().email !== '' && cfg().password !== '';

  function abrir(motivo: string): void {
    motivoFalla = motivo.slice(0, 200);
    ultimaFalla = ahora();
  }

  function cerrar(): void {
    motivoFalla = null;
  }

  async function hacerLogin(): Promise<Sesion> {
    let respuesta: RespuestaPuente;
    try {
      respuesta = await transporte(`${cfg().base}${RUTA_LOGIN}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email: cfg().email, password: cfg().password}),
      });
    } catch {
      abrir('red-tasks: TASKS no responde al login');
      throw {codigo: 'red', mensaje: 'TASKS no responde'} satisfies ErrorKanban;
    }
    if (!respuesta.ok) {
      abrir(respuesta.estado === 401 ? 'credenciales-rechazadas por TASKS' : `login-tasks-${respuesta.estado}`);
      throw {codigo: 'no-autenticado', mensaje: 'Login TASKS rechazado', estadoHttp: respuesta.estado} satisfies ErrorKanban;
    }
    const sessionId = extraerCookie(respuesta.cookies, COOKIE_SESION);
    const csrf = extraerCookie(respuesta.cookies, COOKIE_CSRF);
    if (sessionId === null || csrf === null) {
      abrir('login-tasks-sin-cookies (contrato roto)');
      throw {codigo: 'servidor', mensaje: 'Login TASKS sin cookies de sesión'} satisfies ErrorKanban;
    }
    sesion = {sessionId, csrf};
    return sesion;
  }

  function entrar(): Promise<Sesion> {
    if (accesoLogin === null) {
      accesoLogin = hacerLogin().finally(() => {
        accesoLogin = null;
      });
    }
    return accesoLogin;
  }

  function fetchConSesion(url: string, init: PeticionHttp): Promise<RespuestaHttp> {
    const cabezas = {...(init.headers ?? {})};
    if (sesion !== null) {
      cabezas.cookie = `${COOKIE_SESION}=${sesion.sessionId}; ${COOKIE_CSRF}=${sesion.csrf}`;
    }
    return transporte(url, {...init, headers: cabezas});
  }

  /* PUT/DELETE sobre /api/tasks/:legacy_id (F1 upsert_task/delete_task) o
   * PUT sobre /api/projects/:legacy_id (08AA-6 upsert_project con payload).
   * No pasa por el cliente vendorizado (solo GET/POST). */
  async function pedirApi(
    recurso: 'tasks' | 'projects',
    method: 'PUT' | 'DELETE',
    legacyId: number,
    cuerpo?: Record<string, unknown>,
  ): Promise<unknown> {
    let respuesta: RespuestaHttp;
    try {
      respuesta = await fetchConSesion(`${cfg().base}/api/${recurso}/${legacyId}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(sesion === null ? {} : {[CABECERA_CSRF]: sesion.csrf}),
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
      const cab = respuesta.cabeceras.obtener('retry-after');
      const segs = cab === null ? NaN : Number(cab);
      throw mapearErrorTarea(
        respuesta.estado,
        datos,
        Number.isFinite(segs) && segs >= 0 ? segs * 1000 : undefined,
      );
    }
    return datos;
  }

  /* Proyectos via modulo extraido (08AA-6; el gate limita a 300 lineas). */
  const pedirProyectos = (): Promise<ProyectoPuente[]> =>
    pedirProyectosPuente({base: cfg().base, csrf: sesion?.csrf ?? null, llamar: fetchConSesion});

  /* El cliente lleva la base dentro, así que se rehace cuando la base cambia
   * (el archivo de entorno apareció o se editó con el backend ya arriba). */
  let clienteCache: {base: string; cliente: ClienteKanban} | null = null;
  const cliente = (): ClienteKanban => {
    const base = cfg().base;
    if (clienteCache === null || clienteCache.base !== base) {
      clienteCache = {
        base,
        cliente: crearClienteKanban({base, fetchFn: fetchConSesion, leerCsrf: () => sesion?.csrf ?? null}),
      };
    }
    return clienteCache.cliente;
  };

  /* 429 con `retry-after`: espera acotada con jitter y reintento limitado
   * (el re-login pega en otro limiter: sin tormenta). */
  async function conCuota<T>(trabajo: () => Promise<T>): Promise<T> {
    for (let intento = 0; ; intento += 1) {
      try {
        return await trabajo();
      } catch (e) {
        if (!esKanban(e, 'cuota') || intento >= cfg().maxReintentosCuota) throw e;
        const base = (e as ErrorKanban).reintentarEnMs ?? 1000;
        await dormir(Math.round(Math.min(base, TOPE_ESPERA_CUOTA_MS) * (0.5 + azar())));
      }
    }
  }

  async function operar<T>(trabajo: () => Promise<T>): Promise<T> {
    if (cfg().base === '') {
      throw {codigo: 'red', mensaje: 'sin-base (TASKS_BASE_URL)'} satisfies ErrorKanban;
    }
    if (!conCredenciales()) {
      throw {codigo: 'red', mensaje: 'sin-credenciales (TASKS_EMAIL/TASKS_PASSWORD)'} satisfies ErrorKanban;
    }
    if (motivoFalla !== null && ahora() - ultimaFalla < cfg().enfriamientoMs) {
      throw {codigo: 'red', mensaje: motivoFalla} satisfies ErrorKanban;
    }
    try {
      if (sesion === null) await entrar();
      try {
        const r = await conCuota(trabajo);
        cerrar();
        return r;
      } catch (e) {
        /* 401 con sesión: caducó; re-login con lock y un solo reintento. */
        if (esKanban(e, 'no-autenticado')) {
          sesion = null;
          await entrar();
          const r = await conCuota(trabajo);
          cerrar();
          return r;
        }
        throw e;
      }
    } catch (e) {
      if (esKanban(e, 'red')) abrir(mensajeDe(e, 'red-tasks'));
      throw e;
    }
  }

  /* El parche de una edicion parcial, completado con lo guardado (20AA-10).
   * [por que] El PUT de TASK es de reemplazo: sin `payload` borra el espejo del roadmap y sin
   * `proyectoId` saca la tarjeta de su columna (ver `escritura/parche-completo.ts`). El que ya manda el
   * payload entero —F2— no necesita relectura. TASK no tiene GET por id, asi que la tarea se busca
   * en la columna que declara el parche; si no esta, es un alta y no hay nada que conservar. */
  async function conLoGuardado(legacyId: number, parche: ParcheTarea): Promise<ParcheTarea> {
    if (parche.payload !== undefined || typeof parche.proyectoId !== 'number') return parche;
    const tareas = await cliente().listarTareasProyecto(parche.proyectoId);
    const hallada = tareas.find((t) => t.item.id === legacyId);
    return hallada === undefined ? parche : completarParche(hallada.item, parche);
  }

  return {
    estado(): EstadoPuente {
      if (cfg().base === '') {
        return {disponible: false, motivo: 'sin-base (TASKS_BASE_URL)', base: '', conCredenciales: conCredenciales()};
      }
      if (!conCredenciales()) {
        return {disponible: false, motivo: 'sin-credenciales (TASKS_EMAIL/TASKS_PASSWORD)', base: cfg().base, conCredenciales: false};
      }
      if (motivoFalla !== null && ahora() - ultimaFalla < cfg().enfriamientoMs) {
        return {disponible: false, motivo: motivoFalla, base: cfg().base, conCredenciales: true};
      }
      return {disponible: true, motivo: null, base: cfg().base, conCredenciales: true};
    },
    listar: (legacyId) => operar(() => cliente().listarTareasProyecto(legacyId)),
    proyectos: () => operar(pedirProyectos),
    /* Crea el proyecto TASKS espejo de un repo WM (08AA-6 sync): upsert por
     * id generado + `payload.wmClave` como llave de emparejado futuro. Sin
     * `estado` (TASKS lo deja en `activo` por defecto). Devuelve el id. */
    crearProyecto: (legacyId, nombre, wmClave) => {
      /* Valida antes de operar (sin gastar sesion en un id imposible). */
      if (!esIdValido(legacyId)) {
        return Promise.reject({codigo: 'validacion', mensaje: 'legacyId debe ser un entero positivo'} satisfies ErrorKanban);
      }
      return operar(async () => {
        await pedirApi('projects', 'PUT', legacyId, {nombre, payload: {wmClave}});
        return legacyId;
      });
    },
    reordenar: (lote) => operar(() => cliente().reordenarBulk(lote)),
    actualizar: (legacyId, parche) =>
      operar(async () => {
        if (!esIdValido(legacyId)) {
          throw {codigo: 'validacion', mensaje: 'legacyId debe ser un entero positivo'} satisfies ErrorKanban;
        }
        const datos = await pedirApi('tasks', 'PUT', legacyId, {...(await conLoGuardado(legacyId, parche))});
        if (typeof datos !== 'object' || datos === null || typeof (datos as {id?: unknown}).id !== 'number') {
          throw {codigo: 'servidor', mensaje: 'Respuesta inesperada del servidor'} satisfies ErrorKanban;
        }
        return datos as ItemVersionado;
      }),
    eliminar: (legacyId) =>
      operar(async () => {
        if (!esIdValido(legacyId)) {
          throw {codigo: 'validacion', mensaje: 'legacyId debe ser un entero positivo'} satisfies ErrorKanban;
        }
        await pedirApi('tasks', 'DELETE', legacyId);
      }),
  };
}

/* Puente de producción (env del proceso; el front jamás ve las credenciales). */
export const puenteTareas = crearPuenteTareas();
