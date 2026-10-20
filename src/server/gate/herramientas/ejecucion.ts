/* Ejecución de los runtimes de análisis (sentinel + varsense) por proyecto.
 * [por que] Extraído de `analizador.ts` (límite-líneas): esta es la capa de
 * EJECUCIÓN (resolver binarios, entorno, spawn async, parseo tolerante del
 * reporte); `analizador.ts` conserva la capa de ANÁLISIS (caché por frescura,
 * normalización, single-flight, barrido). La frontera es el `ReporteJson`
 * parseado: nada del formato JSON sale de aquí sin normalizar. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { baseSentinel, raizVersiones, checkoutSentinel, cliSentinelParaProyecto, provisionPathSentinel, versionRuntime, versionSentinel } from './proveedor.js';
import type { ResolucionCli } from './proveedor.js';
/* Raíz del área (misma fuente del server): la caché de análisis vive bajo
 * <area>/data/cache/analisis.json, como la config del workspace. */
import { RAIZ_AREA } from '../../plataforma/rutas.js';
/* [por que] El spawn va por el puerto de procesos para poder inyectar un falso
 * en tests sin lanzar sentinel/varsense de verdad. */
import { PUERTO_PROCESOS } from '../../plataforma/procesos.js';
import type { PuertoProcesos } from '../../plataforma/procesos.js';
/* Tipos y funciones puras (argumentos, parseo): en módulos propios para que este
 * fichero quede con la capa de IO. Reexportados para que los importadores no cambien. */
import type { FuentesRuntime, ResultadoSpawn } from './ejecucion/tipos.js';
import { argsAnalisisSentinel, argsDoctor, argsVarsense, resultadoDeSalida, salidaDoctor, salidaDoctorDeError } from './ejecucion/argumentos.js';

export type { FindingJson, EntryJson, ReporteJson, ResultadoSpawn, FuentesRuntime } from './ejecucion/tipos.js';
export { parsearReporte } from './ejecucion/argumentos.js';

/* [por que] 308A-1 centraliza el runtime: los consumidores declaran
 * `sourcePathEnv: GLORY_SENTINEL_SOURCE_PATH`/`GLORY_VARSENSE_SOURCE_PATH` y
 * resuelven el binario/schema desde el path que esas env señalan. Este server
 * las deriva desde la raíz del área (RAÍZ_AREA/.quality-tools/{sentinel,
 * varsense}) justo ANTES de lanzar sentinel por proyecto, para que cada
 * invocación apunte al checkout compartido. Nunca pisa una env que el usuario
 * ya haya definido: el override manual gana. */
export function entornoGate(rutaProyecto?: string, entorno: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  /* [por que] 039A-4: si el proyecto declara su propio `provisionPath`, el
   * análisis debe correr contra ESE checkout (es el que ejecuta su gate), no
   * contra el compartido. El override manual del usuario sigue ganando. */
  if (entorno.GLORY_SENTINEL_SOURCE_PATH === undefined) {
    const propio = rutaProyecto ? cliSentinelParaProyecto(rutaProyecto) : null;
    env.GLORY_SENTINEL_SOURCE_PATH = propio?.base ?? join(RAIZ_AREA, '.quality-tools', 'sentinel');
  }
  if (entorno.GLORY_VARSENSE_SOURCE_PATH === undefined) {
    env.GLORY_VARSENSE_SOURCE_PATH = join(RAIZ_AREA, '.quality-tools', 'varsense');
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
export function baseVarsense(entorno: NodeJS.ProcessEnv = process.env): string {
  return entorno.GLORY_VARSENSE_SOURCE_PATH || join(RAIZ_AREA, '.quality-tools', 'varsense');
}
export function checkoutVarsense(entorno: NodeJS.ProcessEnv = process.env): string | null {
  const cli = join(baseVarsense(entorno), 'dist', 'cli', 'index.js');
  return existsSync(cli) ? baseVarsense(entorno) : null;
}

/* Fuentes de un runtime, no sus artefactos: la VPS lo compila desde aquí. [por que]
 * El portátil ya no genera ni envía `out/` o `dist/`: un checkout recién clonado (sin
 * compilar) basta, porque lo que se copia es el código y su manifest. Devuelve null si
 * faltan `src/` o `package.json`. */
export function fuentesDeRuntime(base: string): FuentesRuntime | null {
  try {
    if (!existsSync(join(base, 'src')) || !existsSync(join(base, 'package.json'))) return null;
    const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? { base, version: pkg.version } : null;
  } catch {
    return null;
  }
}

/* Fuentes de sentinel para un proyecto: su checkout propio (`provisionPath`) si lo
 * declara y el pin coincide con la versión de ese checkout; si no, el compartido.
 * [por que] Mismo criterio que cliSentinelParaProyecto: el gate del proyecto mide con
 * el checkout que fija su manifest. */
export function fuentesSentinel(rutaProyecto?: string): FuentesRuntime | null {
  const propio = rutaProyecto ? provisionPathSentinel(rutaProyecto) : null;
  const fuentes = propio ? fuentesDeRuntime(propio.ruta) : null;
  if (fuentes && (!propio?.pin || propio.pin === fuentes.version)) return fuentes;
  return fuentesDeRuntime(baseSentinel());
}

/* Fuentes de varsense del checkout compartido. */
export function fuentesVarsense(): FuentesRuntime | null {
  return fuentesDeRuntime(baseVarsense());
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

/* Varsense aplica al proyecto si lo declara (varsense.config.json) y el runtime
 * esta provisionado. [por que] Separa "no aplica" (null legitimo) de "aplica y
 * fallo" (correrVarsense devuelve null por timeout o salida no JSON): solo el
 * segundo no puede quedar como 'ok' en el tablero. */
export function varsenseAplica(ruta: string): boolean {
  return existsSync(join(ruta, 'varsense.config.json')) && varsenseRuntime() !== null;
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
  const cli = join(raizVersiones(), v, 'out', 'cli', 'index.js');
  if (!existsSync(cli)) return null;
  return { base: join(raizVersiones(), v), cli, version: v, commit: null };
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
export async function correrSentinel(ruta: string, puerto: PuertoProcesos = PUERTO_PROCESOS): Promise<ResultadoSpawn | null> {
  const res = cliRuntime(ruta);
  if (!res) return null;
  /* Versión y commit que se REGISTRAN en el análisis: los del runtime que
   * realmente ejecuta (provisionPath propio > compartido > instalado).
   * [por que] 2026-09-10: `cliRuntime()` ya resolvía el checkout 0.7.8 pero
   * aquí se anotaba `versionRuntime()` (0.7.4), así que el panel decía medir
   * con una herramienta que no era la que corría. 039A-4 añade el commit. */
  /* [por que] 2026-10-10: proyecto-ejemplo (993 archivos) tarda ~58 s en
   * `analyze` con el sistema cargado; con 60 s el timeout mataba el proceso,
   * no había stdout y el gate marcaba 'error' falso. 180 s da margen. */
  const opciones = {
    windowsHide: true,
    timeout: 180000,
    env: { ...process.env, ...entornoGate(ruta) },
  };
  try {
    const { stdout } = await puerto.ejecutar(process.execPath, argsAnalisisSentinel(res.cli, ruta), opciones);
    return resultadoDeSalida(stdout, res.version, res.commit);
  } catch (err) {
    return resultadoDeSalida((err as { stdout?: string }).stdout, res.version, res.commit);
  }
}

/* Ejecuta `sentinel doctor` en el portátil (bajo demanda, no en el escaneo inicial).
 * [por que] Nunca el `sentinel` del PATH: el CLI sale del checkout que declara el
 * proyecto (`cliRuntime`), con `node <cli>` y args en array, sin shell ni shim .cmd.
 * Asíncrono como el análisis: `execFileSync` aquí bloqueaba toda la API durante el
 * doctor. Devuelve null si no hay runtime o si no hay nada que mostrar. */
export async function correrDoctorLocal(ruta: string, puerto: PuertoProcesos = PUERTO_PROCESOS): Promise<string | null> {
  const res = cliRuntime(ruta);
  if (!res) return null;
  try {
    const { stdout } = await puerto.ejecutar(
      process.execPath,
      argsDoctor(res.cli, ruta),
      { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    return salidaDoctor(stdout);
  } catch (err) {
    return salidaDoctorDeError(err as { stdout?: string; signal?: string | null });
  }
}

/* Ejecuta `varsense all` si el proyecto lo declara (varsense.config.json) y
 * el runtime está provisionado en el checkout compartido. Misma convención
 * de exit code que sentinel: != 0 con hallazgos de severidad 'error' (el
 * reporte válido va en stdout); 2 = fallo real. Devuelve null si no aplica. */
export async function correrVarsense(ruta: string, puerto: PuertoProcesos = PUERTO_PROCESOS): Promise<ResultadoSpawn | null> {
  const base = checkoutVarsense();
  if (!base) return null;
  if (!existsSync(join(ruta, 'varsense.config.json'))) return null;
  const vs = varsenseRuntime();
  if (!vs) return null;
  const cli = join(base, 'dist', 'cli', 'index.js');
  const opciones = {
    windowsHide: true,
    // [porque] Igual que sentinel (180 s): un timeout corto marca el gate como
    // fallido aunque varsense funcione; el recorrido de árboles grandes tarda.
    timeout: 180000,
  };
  try {
    const { stdout } = await puerto.ejecutar(process.execPath, argsVarsense(cli, ruta), opciones);
    return resultadoDeSalida(stdout, vs.version, null);
  } catch (err) {
    return resultadoDeSalida((err as { stdout?: string }).stdout, vs.version, null);
  }
}
