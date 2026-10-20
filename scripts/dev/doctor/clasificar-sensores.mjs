/* Sensor de escucha de puertos (E/S): lee los sockets del sistema con un reintento. */

import { escanearSockets } from './sistema/procesos.mjs';

/* Escucha con UN reintento ante arranque frio (powershell+CIM tras idle
 * en maquina cargada puede superar los 10s —medido 9s solo el arranque— y
 * no es defecto del area). Dos fallos = real. */
export async function escuchaRobusta() {
  try {
    return { ...(await escanearSockets()), errorSensor: null };
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      return { ...(await escanearSockets()), errorSensor: null };
    } catch (e2) {
      return { escucha: [], establecidas: [], errorSensor: `sensor: ${e.message} / reintento: ${e2.message}` };
    }
  }
}
