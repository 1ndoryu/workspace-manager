/* Listado de proyectos TASKS para la sync de columnas (08AA-6).
 * [por que] Extraido de `puente-tareas.ts` (el gate limita a 300 lineas por
 * modulo): el GET /api/dashboard con sesion no pasa por el cliente
 * vendorizado (solo cubre F1 kanban); el agregado trae data.proyectos
 * (nombre/estado/orden por proyecto) y el 401 re-entra por `operar` igual
 * que listar (mapearErrorTarea lo marca no-autenticado). */
import {CABECERA_CSRF} from './nucleo/cliente.js';
import type {ErrorKanban, PeticionHttp, RespuestaHttp} from './nucleo/tipos.js';
import {mapearErrorTarea, proyectosDeAgregado, type ProyectoPuente} from './tarea-unitaria.js';

export interface PedidoProyectos {
  base: string;
  csrf: string | null;
  llamar(url: string, init: PeticionHttp): Promise<RespuestaHttp>;
}

export async function pedirProyectosPuente(p: PedidoProyectos): Promise<ProyectoPuente[]> {
  let respuesta: RespuestaHttp;
  try {
    respuesta = await p.llamar(`${p.base}/api/dashboard`, {
      method: 'GET',
      headers: {
        ...(p.csrf === null ? {} : {[CABECERA_CSRF]: p.csrf}),
      },
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
  return proyectosDeAgregado(datos);
}
