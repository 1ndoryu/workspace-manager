/* Config del puente de tareas: de dónde salen la base y las credenciales.
 * [por que] Vive aparte del puente porque es lo que decide si la tab está
 * disponible o no, y se resuelve en cada uso en vez de al construir. */
import {entornoTareas} from './entorno-tareas.js';

export interface ConfigPuente {
  base: string;
  email: string;
  password: string;
  timeoutMs: number;
  maxReintentosCuota: number;
  enfriamientoMs: number;
}

/* Sin TASKS_BASE_URL la base queda vacía: el puente se declara «sin-base» en vez de
 * asumir un puerto de otra máquina. */
export function leerConfigPuente(env: Record<string, string | undefined> = process.env): ConfigPuente {
  return {
    base: (env.TASKS_BASE_URL ?? '').trim(),
    email: (env.TASKS_EMAIL ?? '').trim(),
    password: (env.TASKS_PASSWORD ?? '').trim(),
    timeoutMs: 10_000,
    maxReintentosCuota: 3,
    enfriamientoMs: 30_000,
  };
}

/* [por que] En cada uso, no al construir: con el backend ya arriba, un
 * `logs/.tareas-env` que aparece o cambia se nota en la llamada siguiente
 * («reintentar» en la tab) sin reiniciar nada. Antes las claves llegaban solo
 * por `--env-file-if-exists`, así que un backend arrancado por otra vía servía
 * el 8787 sin ellas y la tab decía «sin-base» con el archivo en su sitio. */
export const configPuenteViva = (): ConfigPuente => leerConfigPuente(entornoTareas());
