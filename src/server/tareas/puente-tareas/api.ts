/* Llamadas HTTP del puente a TASKS por encima de la sesion (19AA-13).
 * [por que] Sacado de crearPuenteTareas: PUT/DELETE directos a la API, proyectos
 * y cliente vendorizado (solo GET/POST). Toda llamada pasa por la sesion del
 * nucleo, asi que el breaker y el re-login siguen aplicando. */
import {crearClienteKanban, CABECERA_CSRF, type ClienteKanban} from '../nucleo/cliente.js';
import type {ErrorKanban, RespuestaHttp} from '../nucleo/tipos.js';
import {mapearErrorTarea, type ParcheTarea, type ProyectoPuente} from '../tarea-unitaria.js';
import {completarParche} from '../escritura/parche-completo.js';
import {pedirProyectosPuente} from '../proyectos-puente.js';
import type {ConfigPuente} from '../entorno/config-puente.js';
import type {NucleoSesion} from './nucleo-sesion.js';

export interface ApiPuente {
  pedirApi(recurso: 'tasks' | 'projects', method: 'PUT' | 'DELETE', legacyId: number, cuerpo?: Record<string, unknown>): Promise<unknown>;
  pedirProyectos(): Promise<ProyectoPuente[]>;
  cliente(): ClienteKanban;
  conLoGuardado(legacyId: number, parche: ParcheTarea): Promise<ParcheTarea>;
}

export function crearApiPuente(cfg: () => ConfigPuente, nucleo: NucleoSesion): ApiPuente {
  /* PUT/DELETE sobre /api/tasks/:legacy_id (F1 upsert_task/delete_task) o
   * PUT sobre /api/projects/:legacy_id (08AA-6 upsert_project con payload).
   * No pasa por el cliente vendorizado (solo GET/POST). */
  async function pedirApi(
    recurso: 'tasks' | 'projects',
    method: 'PUT' | 'DELETE',
    legacyId: number,
    cuerpo?: Record<string, unknown>,
  ): Promise<unknown> {
    const sesion = nucleo.sesionActual();
    let respuesta: RespuestaHttp;
    try {
      respuesta = await nucleo.fetchConSesion(`${cfg().base}/api/${recurso}/${legacyId}`, {
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
    pedirProyectosPuente({
      base: cfg().base,
      csrf: nucleo.sesionActual()?.csrf ?? null,
      llamar: nucleo.fetchConSesion,
    });

  /* El cliente lleva la base dentro, así que se rehace cuando la base cambia
   * (el archivo de entorno apareció o se editó con el backend ya arriba). */
  let clienteCache: {base: string; cliente: ClienteKanban} | null = null;
  const cliente = (): ClienteKanban => {
    const base = cfg().base;
    if (clienteCache === null || clienteCache.base !== base) {
      clienteCache = {
        base,
        cliente: crearClienteKanban({
          base,
          fetchFn: nucleo.fetchConSesion,
          leerCsrf: () => nucleo.sesionActual()?.csrf ?? null,
        }),
      };
    }
    return clienteCache.cliente;
  };

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

  return {pedirApi, pedirProyectos, cliente, conLoGuardado};
}
