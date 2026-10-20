/* Cliente HTTP del panel del taller (20AA-16): habla con /api/taller/*.
 * [por que] El frente no habla con pulse: el Bearer vive en el servidor (agenteTaller.ts) y la
 * lista de proyectos en el registro. Aquí solo se piden las dos respuestas ya masticadas. Mismo
 * patrón que apiVps.ts y sin caché de módulo: el snapshot lo sondea el hook cada 5 s (el servidor
 * ya cachea) y las piezas van a demanda, una por clic. */
import axios from 'axios';
import type { ProyectoTaller } from '../../shared/taller/proyecto.js';
import type { VpsAgenteRespuesta, VpsPieza, VpsPiezaRespuesta } from '../../shared/types.js';

/* El snapshot del taller es el mismo contrato que el de vps (es la misma glory-pulse) más las
 * filas del registro, que es lo único que pulse no puede aportar: un proyecto parado no tiene
 * procesos, pero sigue teniendo sesión, puerto y hostname. */
export interface RespuestaAgenteTaller extends VpsAgenteRespuesta {
  proyectos?: ProyectoTaller[];
}

export async function agenteTaller(senal?: AbortSignal): Promise<RespuestaAgenteTaller> {
  const { data } = await axios.get<RespuestaAgenteTaller>('/api/taller/agente', { signal: senal });
  return data;
}

/* Una pieza pesada bajo demanda: sin caché (cada clic es fresco) y con la señal del llamante,
 * que es quien pone el timeout de UX y aborta al cambiar de proyecto. */
export async function piezaTaller(
  sitio: string,
  pieza: string,
  opts?: { senal?: AbortSignal },
): Promise<VpsPieza> {
  const { data } = await axios.get<VpsPiezaRespuesta>('/api/taller/pieza', {
    params: { sitio, pieza },
    signal: opts?.senal,
  });
  return data.resultado;
}
