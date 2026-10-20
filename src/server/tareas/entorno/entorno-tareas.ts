/* Entorno del puente de tareas: `logs/.tareas-env` (KEY=VALUE, gitignored).
 * [por que] El backend lo lee él mismo en vez de fiarse del lanzador: antes las
 * claves llegaban solo por `--env-file-if-exists` de `npm run server`, así que
 * un `node dist-server/server/index.js` arrancado por otra vía servía el 8787
 * sin ellas y la tab decía «sin-base» con el archivo en su sitio (2026-10-19).
 * Leerlo aquí, en cada consulta y con caché por mtime, hace que la tab se
 * recupere con «reintentar» sin reiniciar el backend. */
import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RAIZ_REPO } from '../../plataforma/rutas.js';

const RUTA_ENV_TAREAS = join(RAIZ_REPO, 'logs', '.tareas-env');
const CLAVES = ['TASKS_BASE_URL', 'TASKS_EMAIL', 'TASKS_PASSWORD'] as const;

/* Caché por mtime: sin cambios en el archivo no se vuelve a leer ni a parsear. */
let cache: {ruta: string; mtimeMs: number; valores: Record<string, string>} | null = null;

/* Lee el archivo y devuelve solo las claves del puente con valor no vacío. */
export function leerEnvTareas(ruta: string = RUTA_ENV_TAREAS): Record<string, string> {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(ruta).mtimeMs;
  } catch {
    return {}; /* Sin archivo: el puente informa sin-base, no revienta. */
  }
  if (cache && cache.ruta === ruta && cache.mtimeMs === mtimeMs) return cache.valores;

  const valores: Record<string, string> = {};
  try {
    for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(linea);
      if (m && (CLAVES as readonly string[]).includes(m[1]) && m[2] !== '') valores[m[1]] = m[2];
    }
  } catch {
    return {};
  }
  cache = {ruta, mtimeMs, valores};
  return valores;
}

/* Entorno efectivo: el del proceso manda (pruebas y overrides); el archivo
 * rellena lo que falte. Un valor vacío en el proceso no pisa al del archivo. */
export function entornoTareas(
  env: Record<string, string | undefined> = process.env,
  ruta: string = RUTA_ENV_TAREAS,
): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(leerEnvTareas(ruta))) salida[clave] = valor;
  for (const clave of CLAVES) {
    const valor = env[clave];
    if (typeof valor === 'string' && valor.trim() !== '') salida[clave] = valor;
  }
  return salida;
}
