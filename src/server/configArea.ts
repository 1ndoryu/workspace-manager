/* Config persistente del workspace (excepciones y overrides por proyecto).
 * [por que] El escaner necesita saber que proyectos ignorar y el cliente los
 * gestiona en la pagina de configuracion. Se guarda en un JSON durable dentro
 * de la propia area (la app ya escribe la cache ahi), fuera de git. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConfigScan, ConfigWorkspace } from '../shared/types.js';

/* Una sola fuente: data/workspace.config.json en la raiz del area. */
export const NOMBRE_CONFIG = 'workspace.config.json';
/* [por que] v2: agrega la seccion 'scan' (analisis automatico de sentinel,
 * opt-in y apagado por defecto). Una config v1 (ignorados a secas) sigue
 * valid siendo leida, se normaliza al default de scan. v3 (308A-1): agrega
 * 'sinGate' (proyectos del gate exentos de llevar gate, solo glory-sentinel). */
export const CONFIG_DEFECTO: ConfigWorkspace = {
  version: 3,
  ignorados: [],
  sinGate: [],
  scan: { automatico: false, intervaloMin: 30 },
};

/* Normaliza el valor scan desde un JSON arbitrario (ausente => apagado). */
function normalizarScan(d: Partial<ConfigWorkspace>): ConfigScan | undefined {
  const s = d.scan;
  if (!s || typeof s !== 'object') return { automatico: false, intervaloMin: 30 };
  return {
    automatico: typeof s.automatico === 'boolean' ? s.automatico : false,
    intervaloMin:
      typeof s.intervaloMin === 'number' && s.intervaloMin > 0
        ? Math.min(Math.round(s.intervaloMin), 1440)
        : 30,
    pedirSoloProblemas:
      typeof s.pedirSoloProblemas === 'boolean' ? s.pedirSoloProblemas : undefined,
  };
}

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
      /* [por que] sinGate es opt-in por excepcion explicita (Solo glory-sentinel);
       * normaliza igual que ignorados para no aceptar basura. */
      sinGate: Array.isArray(d.sinGate)
        ? [...new Set(d.sinGate.filter((x) => typeof x === 'string' && x.length > 0))]
        : [],
      scan: normalizarScan(d),
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

/* Actualiza la seccion 'scan' (automatico + intervalo) y persiste.
 * [por que] Lo llama el endpoint /api/config/scan desde el PanelConfig; la
 * config se lee del disco y se re-guarda con el scan nuevo, sin perder el
 * resto (ignorados). Devuelve la config completa para que el cliente pueda
 * aplicar directo al snapshot. */
export function guardarConfigScan(raiz: string, scan: ConfigWorkspace['scan']): ConfigWorkspace {
  const config = leerConfigArea(raiz);
  config.scan = scan ?? { automatico: false, intervaloMin: 30 };
  config.version = 2;
  guardarConfigArea(raiz, config);
  return config;
}

/* Alterna la clave de un proyecto en la lista sinGate (exencion del gate) y
 * persiste. [por que] Plan 308A-1 F6: solo glory-sentinel (el runtime) es
 * elegible; el endpoint valida la clave, aqui solo se persiste la lista. */
export function cambiarSinGate(raiz: string, clave: string, eximir: boolean): ConfigWorkspace {
  const config = leerConfigArea(raiz);
  const sinDuplicados = (config.sinGate ?? []).filter((c) => c !== clave);
  config.sinGate = eximir ? [...sinDuplicados, clave] : sinDuplicados;
  config.version = 3;
  guardarConfigArea(raiz, config);
  return config;
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