/* Entorno de arranque de una entrada: token de pulse y credenciales de tareas. */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RAIZ_REPO } from '../base.mjs';

/* Token local ESTABLE para pulse: se genera una vez y se guarda en
 * <repo>/logs/.pulse-token (gitignored); el backend lo lee para hablar con
 * pulse sin reiniciarse. En local vale cualquiera >=32 (el real solo vive
 * en Coolify y jamas se commitea); si el entorno ya trae uno, se respeta. */
const RUTA_TOKEN_PULSE = join(RAIZ_REPO, 'logs', '.pulse-token');


/* Credenciales del puente de tareas (PROYECTO TASKS, 07AA-5 F2): archivo local
 * gitignored `logs/.tareas-env` (KEY=VALUE, una por linea). Solo lo lee el
 * backend de workspace-manager, que es quien hace el puente.
 * [por que] Asi el puente arranca con el tablero sin variables de usuario ni
 * secretos en registro.json, logs o commits. Entra al hijo solo si el entorno
 * de proceso y el `env` del mando no lo traen ya. */
const RUTA_ENV_TAREAS = join(RAIZ_REPO, 'logs', '.tareas-env');

const CLAVES_TAREAS = ['TASKS_BASE_URL', 'TASKS_EMAIL', 'TASKS_PASSWORD'];

function leerEnvTareas() {
  let texto = '';
  try {
    texto = readFileSync(RUTA_ENV_TAREAS, 'utf8');
  } catch {
    return {}; /* Sin archivo: el puente informa sin-credenciales, no falla el `up`. */
  }
  const valores = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(linea);
    if (m && CLAVES_TAREAS.includes(m[1]) && m[2] !== '') valores[m[1]] = m[2];
  }
  return valores;
}


export function envPara(entrada) {
  // [por que] Lo declarado en `env` se suma al entorno del hijo (lanzar lo
  // mezcla sobre process.env). PULSE_TOKEN de proceso o declarado se respeta:
  // el token estable del archivo solo entra cuando falta en ambos.
  const extra = entrada.env && typeof entrada.env === 'object' ? { ...entrada.env } : undefined;
  if (entrada.envTareas === true) {
    const salida = { ...extra };
    for (const [clave, valor] of Object.entries(leerEnvTareas())) {
      if (!process.env[clave] && salida[clave] === undefined) salida[clave] = valor;
    }
    return salida;
  }
  if (entrada.tokenPulse !== true || process.env.PULSE_TOKEN || (extra && extra.PULSE_TOKEN)) return extra;
  let token = '';
  try {
    token = readFileSync(RUTA_TOKEN_PULSE, 'utf8').trim();
  } catch {
    /* Aun no existe: se genera abajo. */
  }
  if (token.length < 32) {
    token = randomBytes(32).toString('hex');
    try {
      mkdirSync(join(RAIZ_REPO, 'logs'), { recursive: true });
      /* Solo el dueño lee el token (en Linux; en Windows el modo se ignora). */
      writeFileSync(RUTA_TOKEN_PULSE, `${token}\n`, { mode: 0o600 });
    } catch {
      /* Disco: se usa en memoria solo esta vez. */
    }
  }
  return { ...extra, PULSE_TOKEN: token };
}

