/* Config persistente del workspace (excepciones y overrides por proyecto).
 * [por que] El escaner necesita saber que proyectos ignorar y el cliente los
 * gestiona en la pagina de configuracion. Se guarda en un JSON durable dentro
 * de la propia area (la app ya escribe la cache ahi), fuera de git. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConfigWorkspace } from '../shared/types.js';

/* Una sola fuente: data/workspace.config.json en la raiz del area. */
export const NOMBRE_CONFIG = 'workspace.config.json';
export const CONFIG_DEFECTO: ConfigWorkspace = { version: 1, ignorados: [] };

export function rutaConfig(raiz: string): string {
  return join(raiz, 'data', NOMBRE_CONFIG);
}

/* Lee la config; ante cualquier problema devuelve el valor por defecto
 * (una config rota no debe tumbar el escaneo). */
export function leerConfigArea(raiz: string): ConfigWorkspace {
  const ruta = rutaConfig(raiz);
  if (!existsSync(ruta)) return CONFIG_DEFECTO;
  try {
    const d = JSON.parse(readFileSync(ruta, 'utf8')) as Partial<ConfigWorkspace>;
    if (!Array.isArray(d.ignorados)) return CONFIG_DEFECTO;
    return {
      version: typeof d.version === 'number' ? d.version : CONFIG_DEFECTO.version,
      /* Normaliza: solo strings no vacios, unicos, sin duplicados. */
      ignorados: [...new Set(d.ignorados.filter((x) => typeof x === 'string' && x.length > 0))],
    };
  } catch {
    return CONFIG_DEFECTO;
  }
}

/* Escribe la config en disco. Lanza si no se puede (para que el endpoint
 * devuelva un error real y el usuario lo vea en toast). */
export function guardarConfigArea(raiz: string, config: ConfigWorkspace): void {
  const ruta = rutaConfig(raiz);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify(config, null, 2), 'utf8');
}

/* Alterna la clave de un proyecto en la lista de ignorados y persiste. */
export function cambiarIgnorado(raiz: string, clave: string, ignorar: boolean): ConfigWorkspace {
  const config = leerConfigArea(raiz);
  const sinDuplicados = config.ignorados.filter((c) => c !== clave);
  config.ignorados = ignorar
    ? [...sinDuplicados, clave]
    : sinDuplicados;
  guardarConfigArea(raiz, config);
  return config;
}