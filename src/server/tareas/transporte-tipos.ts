/* Contrato del transporte HTTP del puente TASKS. Módulo hoja: sin importar nada del
 * puente ni de los transportes.
 * [por que] `transporte-tareas.ts` (el stack nativo) y `puente-tareas.ts` (quien lo
 * usa) se importaban mutuamente por estos tipos: un ciclo que solo existía en tipos,
 * pero que obligaba a leer los dos archivos para entender uno. Aquí vive el contrato
 * y ambos dependen de él, no el uno del otro. */
import type {PeticionHttp, RespuestaHttp} from './nucleo/tipos.js';

/* Respuesta con las cookies de sesion separadas (el fetch global las junta). */
export interface RespuestaPuente extends RespuestaHttp {
  cookies: string[];
}

export type FetchPuente = (url: string, init: PeticionHttp) => Promise<RespuestaPuente>;
