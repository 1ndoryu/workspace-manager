/* Errores del puente TASKS y motivos de rechazo previo. [por que] Funciones puras: sin red
 * ni estado, así que se prueban sin transporte. */
import type {ConfigPuente} from '../entorno/config-puente.js';
import type {ErrorKanban} from '../nucleo/tipos.js';

export function esKanban(e: unknown, codigo: ErrorKanban['codigo']): boolean {
  return typeof e === 'object' && e !== null && (e as {codigo?: unknown}).codigo === codigo;
}

export function mensajeDe(e: unknown, defecto: string): string {
  const m = (e as {mensaje?: unknown} | null)?.mensaje;
  return typeof m === 'string' && m ? m.slice(0, 200) : defecto;
}

/* [por que] Mismo rechazo para crear, actualizar y eliminar: un id no válido no gasta sesión. */
export function errorIdInvalido(): ErrorKanban {
  return {codigo: 'validacion', mensaje: 'legacyId debe ser un entero positivo'};
}

/* Motivo por el que el puente no puede operar por falta de config, o null si la config basta. */
export function motivoSinConfig(cfg: Pick<ConfigPuente, 'base' | 'email' | 'password'>): string | null {
  if (cfg.base === '') return 'sin-base (TASKS_BASE_URL)';
  if (cfg.email === '' || cfg.password === '') return 'sin-credenciales (TASKS_EMAIL/TASKS_PASSWORD)';
  return null;
}
