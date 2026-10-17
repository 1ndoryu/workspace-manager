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
 * 'sinGate' (proyectos del gate exentos de llevar gate: solo el declarado
 * como papel `sentinel` en config/area.json).
 * v4: agrega 'varsenseOpcional' (proyectos con sentinel exentos de varsense).
 * v5: agrega 'carpetasIgnoradas' y 'carpetasRecursivas' (el escaner traia
 * incrustados los nombres de carpeta de NUESTRA area). */
export const CONFIG_DEFECTO: ConfigWorkspace = {
  version: 5,
  ignorados: [],
  sinGate: [],
  varsenseOpcional: [],
  carpetasIgnoradas: [],
  carpetasRecursivas: [],
  carpetasPesadas: [],
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

/* Normaliza una lista de la config: solo strings no vacios, sin duplicados.
 * [por que] Las cuatro listas (ignorados, sinGate, varsenseOpcional y las dos de
 * carpetas) se validaban repitiendo el mismo filter+Set; una lista nueva se
 * olvidaba. Aqui esta la unica regla. */
function listaTexto(v: unknown): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    : [];
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
      ignorados: listaTexto(d.ignorados),
      /* [por que] sinGate es opt-in por excepcion explicita (solo el papel
       * `sentinel`). */
      sinGate: listaTexto(d.sinGate),
      /* [por que] varsenseOpcional (v4) es opt-in por excepcion explicita
       * (proyectos con sentinel donde varsense no aporta, p. ej. Tailwind
       * sin tokens); ausente => lista vacia, sin cambiar conducta. */
      varsenseOpcional: listaTexto(d.varsenseOpcional),
      /* [por que] v5: ausentes => listas vacias, y el escaner se queda con las
       * carpetas estructurales, que son las unicas que tiene cualquier area. */
      carpetasIgnoradas: listaTexto(d.carpetasIgnoradas),
      carpetasRecursivas: listaTexto(d.carpetasRecursivas),
      carpetasPesadas: listaTexto(d.carpetasPesadas),
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
  /* [por que] No degradar la version del esquema: el area ya puede tener
   * 'sinGate' (v3); al guardar el scan no debe retroceder a v2. */
  config.version = CONFIG_DEFECTO.version;
  guardarConfigArea(raiz, config);
  return config;
}

/* Alterna la clave de un proyecto en la lista sinGate (exencion del gate) y
 * persiste. [por que] Plan 308A-1 F6: solo el motor de calidad del area (papel
 * `sentinel`) es elegible; el endpoint valida la clave, aqui solo se persiste
 * la lista. */
export function cambiarSinGate(raiz: string, clave: string, eximir: boolean): ConfigWorkspace {
  const config = leerConfigArea(raiz);
  const sinDuplicados = (config.sinGate ?? []).filter((c) => c !== clave);
  config.sinGate = eximir ? [...sinDuplicados, clave] : sinDuplicados;
  config.version = CONFIG_DEFECTO.version;
  guardarConfigArea(raiz, config);
  return config;
}

/* Alterna la clave de un proyecto en la lista varsenseOpcional (exencion de
 * varsense con sentinel declarado) y persiste. [por que] Espejo de sinGate
 * para el caso Tailwind-sin-tokens: el proyecto conserva su gate sentinel y
 * solo se silencia "varsense ausente". */
export function cambiarVarsenseOpcional(raiz: string, clave: string, eximir: boolean): ConfigWorkspace {
  const config = leerConfigArea(raiz);
  const sinDuplicados = (config.varsenseOpcional ?? []).filter((c) => c !== clave);
  config.varsenseOpcional = eximir ? [...sinDuplicados, clave] : sinDuplicados;
  config.version = CONFIG_DEFECTO.version;
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