/* Ejecución de los runtimes de análisis (sentinel + varsense) por proyecto.
 * [por que] Extraído de `analizador.ts` (límite-líneas): esta es la capa de
 * EJECUCIÓN (resolver binarios, entorno, spawn async, parseo tolerante del
 * reporte); `analizador.ts` conserva la capa de ANÁLISIS (caché por frescura,
 * normalización, single-flight, barrido). La frontera es el `ReporteJson`
 * parseado: nada del formato JSON sale de aquí sin normalizar. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_VERSIONS, checkoutSentinel, cliSentinelParaProyecto, versionRuntime, versionSentinel } from './proveedor.js';
import type { ResolucionCli } from './proveedor.js';

/* Tipos del JSON real que devuelve `sentinel analyze --format json` (varsense
 * `all` comparte la forma: severityCounts + entries con findings). No se
 * importa nada del runtime: se normaliza en `analizador.ts` para aislar el
 * formato. */
export interface FindingJson {
  ruleId?: unknown;
  message?: unknown;
  mensaje?: unknown;
  severity?: unknown;
  severidad?: unknown;
  suggestion?: unknown;
  range?: { start?: { line?: unknown } };
}

export interface EntryJson {
  ruta?: unknown;
  path?: unknown;
  archivo?: unknown;
  findings?: FindingJson[];
}

export interface ReporteJson {
  severityCounts?: Partial<Record<string, number>>;
  entries?: EntryJson[];
}

export interface ResultadoSpawn {
  version: string;
  commit: string | null;
  dato: ReporteJson;
}

/* Raíz del área (misma fuente del server): la caché de análisis vive bajo
 * <area>/data/cache/analisis.json, como la config del workspace. */
export const RAÍZ_AREA = process.env.WS_AREA_ROOT || 'C:/Users/Owner/OneDrive/Documentos/area-trabajo';

/* [por que] 308A-1 centraliza el runtime: los consumidores declaran
 * `sourcePathEnv: GLORY_SENTINEL_SOURCE_PATH`/`GLORY_VARSENSE_SOURCE_PATH` y
 * resuelven el binario/schema desde el path que esas env señalan. Este server
 * las deriva desde la raíz del área (RAÍZ_AREA/.quality-tools/{sentinel,
 * varsense}) justo ANTES de lanzar sentinel por proyecto, para que cada
 * invocación apunte al checkout compartido. Nunca pisa una env que el usuario
 * ya haya definido: el override manual gana. */
export function entornoGate(rutaProyecto?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  /* [por que] 039A-4: si el proyecto declara su propio `provisionPath`, el
   * análisis debe correr contra ESE checkout (es el que ejecuta su gate), no
   * contra el compartido. El override manual del usuario sigue ganando. */
  if (process.env.GLORY_SENTINEL_SOURCE_PATH === undefined) {
    const propio = rutaProyecto ? cliSentinelParaProyecto(rutaProyecto) : null;
    env.GLORY_SENTINEL_SOURCE_PATH = propio?.base ?? join(RAÍZ_AREA, '.quality-tools', 'sentinel');
  }
  if (process.env.GLORY_VARSENSE_SOURCE_PATH === undefined) {
    env.GLORY_VARSENSE_SOURCE_PATH = join(RAÍZ_AREA, '.quality-tools', 'varsense');
  }
  return env;
}

/* Hash corto del artefacto que ejecuta el runtime (out/cli o dist/cli): si el
 * checkout se reconstruye sin cambiar versión ni código del proyecto, la caché
 * quedaba "fresca" con resultados viejos. [por que] 308A-6J11: el conteo de la
 * consola no coincidía con el CLI directo porque la caché persistida servía un
 * análisis de un dist anterior (misma versión). mtime+size del entry basta: un
 * rebuild cambia ambos. */
export function hashArtefacto(ruta: string): string {
  try {
    const st = statSync(ruta);
    return `${st.size}:${Math.trunc(st.mtimeMs)}`;
  } catch {
    return '?';
  }
}

/* Resuelve el runtime de varsense del checkout compartido
 * (<area>/.quality-tools/varsense). [por que] 308A-1 centraliza el runtime;
 * el override de env (GLORY_VARSENSE_SOURCE_PATH) gana, igual que en
 * `entornoGate`. Devuelve null si no está provisionado. */
export function checkoutVarsense(): string | null {
  const base = process.env.GLORY_VARSENSE_SOURCE_PATH || join(RAÍZ_AREA, '.quality-tools', 'varsense');
  const cli = join(base, 'dist', 'cli', 'index.js');
  return existsSync(cli) ? base : null;
}

/* Versión real de varsense (desde su package.json). null si no hay runtime. */
export function varsenseRuntime(): { version: string } | null {
  try {
    const base = checkoutVarsense();
    if (!base) return null;
    const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? { version: pkg.version } : null;
  } catch {
    return null;
  }
}

/* Hash del varsense.config.json del proyecto (o null si no lo declara): si la
 * config cambia, el análisis de varsense cambia aunque el código no. */
export function varsenseConfigHash(ruta: string): string | null {
  try {
    const f = join(ruta, 'varsense.config.json');
    if (!existsSync(f)) return null;
    return createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/* Resolución del bin real del runtime: node out/cli/index.js. [por que] El shim
 * `sentinel` .cmd requiere shell; usar el entry node del runtime permite
 * execFileSync sin shell (seguridad: args como array, nunca un string de
 * shell). Orden de prioridad (039A-4): el `provisionPath` propio del proyecto
 * si lo declara (es el que ejecuta su gate canónico) > checkout COMPARTIDO
 * (el que fijan los demás) > versión instalada. Devuelve también la versión
 * y el commit del artefacto que va a ejecutar, para registrarlos en el
 * análisis (el panel debe mostrar con qué binario se midió). */
export function cliRuntime(rutaProyecto?: string): ResolucionCli | null {
  if (rutaProyecto) {
    const propio = cliSentinelParaProyecto(rutaProyecto);
    if (propio) return propio;
  }
  const base = checkoutSentinel();
  if (base) {
    const cliCompartido = join(base, 'out', 'cli', 'index.js');
    if (existsSync(cliCompartido)) {
      return { base, cli: cliCompartido, version: versionSentinel() ?? '?', commit: null };
    }
  }
  const v = versionRuntime();
  if (!v) return null;
  const cli = join(RAIZ_VERSIONS, v, 'out', 'cli', 'index.js');
  if (!existsSync(cli)) return null;
  return { base: join(RAIZ_VERSIONS, v), cli, version: v, commit: null };
}

/* Parseo tolerante del reporte JSON: solo es un reporte válido si hay un
 * objeto parseable en stdout. [por que] comparte la lógica entre la rama de
 * éxito y la de exit != 0 (ver correrSentinel). */
export function parsearReporte(stdout: string | undefined): ReporteJson | null {
  if (typeof stdout !== 'string' || !stdout) return null;
  try {
    const dato = JSON.parse(stdout) as ReporteJson;
    return dato && typeof dato === 'object' ? dato : null;
  } catch {
    return null;
  }
}

/* Ejecuta el análisis real (asíncrono, cede el event loop para no congelar la
 * API). [por que] el JSON va SOLO en stdout; el stderr trae logs INFO del
 * analizador que no deben romper el parseo. `sentinel analyze` sale con exit
 * != 0 cuando existen hallazgos de severidad 'error' (contrato del CLI, igual
 * que `grep`), aunque el reporte esté presente y sea válido en stdout;
 * execFileAsync rechaza ante exit != 0 y en el catch hay que leer `err.stdout`.
 * Así el estado del proyecto usa los hallazgos reales (conHallazgos) en lugar
 * de marcarlo 'error' de herramienta. Solo devuelve null si no hay stdout
 * parseable (fallo real de runtime/spawn: el llamador marca 'error'). */
const execFileAsync = promisify(execFile);

export async function correrSentinel(ruta: string): Promise<ResultadoSpawn | null> {
  const res = cliRuntime(ruta);
  if (!res) return null;
  /* Versión y commit que se REGISTRAN en el análisis: los del runtime que
   * realmente ejecuta (provisionPath propio > compartido > instalado).
   * [por que] 2026-09-10: `cliRuntime()` ya resolvía el checkout 0.7.8 pero
   * aquí se anotaba `versionRuntime()` (0.7.4), así que el panel decía medir
   * con una herramienta que no era la que corría. 039A-4 añade el commit. */
  const opciones = {
    encoding: 'utf8' as const,
    windowsHide: true,
    timeout: 60000,
    env: { ...process.env, ...entornoGate(ruta) },
  };
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [res.cli, 'analyze', '--workspace', ruta, '--format', 'json'],
      opciones,
    );
    const dato = parsearReporte(stdout);
    if (!dato) return null;
    return { version: res.version, commit: res.commit, dato };
  } catch (err) {
    const e = err as { stdout?: string };
    const dato = parsearReporte(e.stdout);
    if (!dato) return null;
    return { version: res.version, commit: res.commit, dato };
  }
}

/* Ejecuta `varsense all` si el proyecto lo declara (varsense.config.json) y
 * el runtime está provisionado en el checkout compartido. Misma convención
 * de exit code que sentinel: != 0 con hallazgos de severidad 'error' (el
 * reporte válido va en stdout); 2 = fallo real. Devuelve null si no aplica. */
export async function correrVarsense(ruta: string): Promise<ResultadoSpawn | null> {
  const base = checkoutVarsense();
  if (!base) return null;
  if (!existsSync(join(ruta, 'varsense.config.json'))) return null;
  const vs = varsenseRuntime();
  if (!vs) return null;
  const cli = join(base, 'dist', 'cli', 'index.js');
  const opciones = {
    encoding: 'utf8' as const,
    windowsHide: true,
    timeout: 60000,
  };
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cli, 'all', '--workspace', ruta, '--format', 'json'],
      opciones,
    );
    const dato = parsearReporte(stdout);
    if (!dato) return null;
    return { version: vs.version, commit: null, dato };
  } catch (err) {
    const e = err as { stdout?: string };
    const dato = parsearReporte(e.stdout);
    if (!dato) return null;
    return { version: vs.version, commit: null, dato };
  }
}
