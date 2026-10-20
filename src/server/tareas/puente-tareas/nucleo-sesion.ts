/* Sesion, breaker y operacion del puente con TASKS (07AA-5 F2, D1).
 * [por que] Sacado de crearPuenteTareas (19AA-13): el estado (sesion, lock de
 * re-login, breaker) vive en un cierre propio que comparten todas las
 * operaciones; el puente solo lo compone. Sin cambio de comportamiento. */
import type {ConfigPuente} from '../entorno/config-puente.js';
import type {FetchPuente} from '../transporte/transporte-tipos.js';
import type {ErrorKanban, PeticionHttp, RespuestaHttp} from '../nucleo/tipos.js';
import {cabeceraCookies, loginTasks, type Sesion} from './sesion.js';
import {esKanban, mensajeDe, motivoSinConfig} from './errores.js';
import {esperaCuotaMs} from './cuota.js';

export interface CtxSesion {
  cfg: () => ConfigPuente;
  transporte: FetchPuente;
  dormir: (ms: number) => Promise<void>;
  azar: () => number;
  ahora: () => number;
}

export interface NucleoSesion {
  sesionActual(): Sesion | null;
  fetchConSesion(url: string, init: PeticionHttp): Promise<RespuestaHttp>;
  /* Motivo del breaker mientras siga abierto; null si el puente puede intentar. */
  motivoFallaVigente(): string | null;
  operar<T>(trabajo: () => Promise<T>): Promise<T>;
}

export function crearNucleoSesion(ctx: CtxSesion): NucleoSesion {
  const {cfg, transporte, dormir, azar, ahora} = ctx;

  let sesion: Sesion | null = null;
  /* Lock del re-login (D1): una sola entrada en vuelo aunque N llamadas vean
   * 401 a la vez; el resto espera la misma promesa. */
  let accesoLogin: Promise<Sesion> | null = null;
  let ultimaFalla = 0;
  let motivoFalla: string | null = null;

  function abrir(motivo: string): void {
    motivoFalla = motivo.slice(0, 200);
    ultimaFalla = ahora();
  }

  function cerrar(): void {
    motivoFalla = null;
  }

  async function hacerLogin(): Promise<Sesion> {
    sesion = await loginTasks(transporte, cfg(), abrir);
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
      cabezas.cookie = cabeceraCookies(sesion);
    }
    return transporte(url, {...init, headers: cabezas});
  }

  /* 429 con `retry-after`: espera acotada con jitter y reintento limitado
   * (el re-login pega en otro limiter: sin tormenta). */
  async function conCuota<T>(trabajo: () => Promise<T>): Promise<T> {
    for (let intento = 0; ; intento += 1) {
      try {
        return await trabajo();
      } catch (e) {
        if (!esKanban(e, 'cuota') || intento >= cfg().maxReintentosCuota) throw e;
        const base = (e as ErrorKanban).reintentarEnMs ?? 1000;
        await dormir(esperaCuotaMs(base, azar()));
      }
    }
  }

  function motivoFallaVigente(): string | null {
    return motivoFalla !== null && ahora() - ultimaFalla < cfg().enfriamientoMs ? motivoFalla : null;
  }

  async function operar<T>(trabajo: () => Promise<T>): Promise<T> {
    const sinConfig = motivoSinConfig(cfg());
    if (sinConfig !== null) throw {codigo: 'red', mensaje: sinConfig} satisfies ErrorKanban;
    const vigente = motivoFallaVigente();
    if (vigente !== null) throw {codigo: 'red', mensaje: vigente} satisfies ErrorKanban;
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

  return {
    sesionActual: () => sesion,
    fetchConSesion,
    motivoFallaVigente,
    operar,
  };
}
