/* Analizador real de sentinel por proyecto (plan analisis-sentinel-consola A0).
 * [por que] La consola debe reportar los hallazgos reales que `sentinel
 * analyze` detecta en cada repo SIN consumir recursos. Para eso este modulo:
 *  - corre `sentinel analyze --workspace <ruta> --format json` (una sola vez por
 *    cambio real), nunca dentro del escaneo raiz (~2.6 s) que vive aparte;
 *  - cachea por frescura = branch + HEAD + version de sentinel: si el repo no
 *    cambio y sentinel no cambio, se sirve cacheado sin volver a spawn;
 *  - es elegibilidad por puerta ('sentinel'), salta carpetas/cargo;
 *  - es ejecucion ASINCRONA en cola serial: los spawns ceden el event loop
 *    para no congelar toda la API durante un analizar-todo (un barrido con
 *    execFileSync bloqueaba snapshot/config/doctor durante segundos);
 *  - ante fallo marca 'error' y NUNCA rompe el snapshot.
 * El cliente es 'tonto': pide y muestra; este modulo es el dueno de la ejecucion. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type {
  AnalisisSentinel,
  HallazgoSentinel,
  NombreSeveridad,
  Proyecto,
  SeveridadSentinel,
} from '../../shared/types.js';
import { RAIZ_VERSIONS, versionRuntime } from './proveedor.js';

/* Tipos del JSON real que devuelve `sentinel analyze --format json`. No se
 * importa nada del runtime: se normaliza aqui para aislar el formato. */
interface FindingJson {
  ruleId?: unknown;
  message?: unknown;
  mensaje?: unknown;
  severity?: unknown;
  severidad?: unknown;
  suggestion?: unknown;
  range?: { start?: { line?: unknown } };
}
interface EntryJson {
  ruta?: unknown;
  path?: unknown;
  archivo?: unknown;
  findings?: FindingJson[];
}
interface ReporteJson {
  severityCounts?: Partial<Record<string, number>>;
  entries?: EntryJson[];
}

/* Tipos del JSON real de `varsense all --format json`. Comparte la forma con
 * sentinel (severityCounts + entries con findings) y ademas cada hallazgo
 * lleva `source: 'VarSense'`; se normaliza con la misma estructura, marcando
 * la fuente. */
interface VarsenseFindingJson {
  ruleId?: unknown;
  message?: unknown;
  severity?: unknown;
  range?: { start?: { line?: unknown } };
}
interface VarsenseEntryJson {
  ruta?: unknown;
  findings?: VarsenseFindingJson[];
}
interface VarsenseReporteJson {
  severityCounts?: Partial<Record<string, number>>;
  entries?: VarsenseEntryJson[];
}

/* Dueno de la cache en memoria (clave -> resultado con su frescura). */
interface EntradaCache {
  fresco: string;
  dato: AnalisisSentinel;
}

/* [por que] la persistencia vive dentro del area del manager (data/cache/),
 * NO en el runtime de sentinel (solo lectura) ni en ningun proyecto real. */
function rutaPersistencia(): string {
  return join(RAÍZ_AREA, 'data', 'cache', 'analisis.json');
}

const cache = new Map<string, EntradaCache>();

/* Raiz del area (misma fuente del server): la cache de analisis vive bajo
 * <area>/data/cache/analisis.json, como la config del workspace. */
const RAÍZ_AREA = process.env.WS_AREA_ROOT || 'C:/Users/Owner/OneDrive/Documentos/area-trabajo';

/* Carga la cache persistida al arranque (arranque instantaneo). */
try {
  const obj = JSON.parse(readFileSync(rutaPersistencia(), 'utf8')) as Record<string, EntradaCache>;
  for (const k of Object.keys(obj)) cache.set(k, obj[k]);
} catch {
  /* sin cache persistido: arranca vacio, no es error. */
}

/* Persiste la cache en disco (best-effort: no debe tumbar el analisis). */
function persistir(): void {
  try {
    const obj: Record<string, EntradaCache> = {};
    for (const [k, v] of cache) obj[k] = v;
    mkdirSync(dirname(rutaPersistencia()), { recursive: true });
    writeFileSync(rutaPersistencia(), JSON.stringify(obj, null, 2), 'utf8');
  } catch {
    /* silencioso: la cache en memoria sigue valiendo. */
  }
}

/* [por que] 308A-1 centraliza el runtime: los consumidores declaran
 * `sourcePathEnv: GLORY_SENTINEL_SOURCE_PATH`/`GLORY_VARSENSE_SOURCE_PATH` y
 * resuelven el binario/schema desde el path que esas env senalan. Este server
 * las deriva desde la raiz del area (RAIZ_AREA/.quality-tools/{sentinel,
 * varsense}) justo ANTES de lanzar sentinel por proyecto, para que cada
 * invocacion apunte al checkout compartido. Nunca pisa una env que el usuario
 * ya haya definido: el override manual gana. */
function entornoGate(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const derivar = (nombre: string, sub: string): void => {
    if (process.env[nombre] === undefined) {
      env[nombre] = join(RAÍZ_AREA, '.quality-tools', sub);
    }
  };
  derivar('GLORY_SENTINEL_SOURCE_PATH', 'sentinel');
  derivar('GLORY_VARSENSE_SOURCE_PATH', 'varsense');
  return env;
}

/* Solo los proyectos cuyo gate real es sentinel (carpetas/cargo no aplican). */
export function esElegible(p: Proyecto): boolean {
  return p.gate?.puerta === 'sentinel';
}

/* Clave de frescura: branch + HEAD + version de sentinel + (si el proyecto
 * declara varsense) version de varsense + hash de su config. [por que] El
 * analisis fusiona ambos reportes (fase G): si varsense cambia de version o
 * su `varsense.config.json` cambia, el resultado deja de ser fresco aunque el
 * repo y sentinel no cambien. */
function frescoDe(p: Proyecto): string {
  const rama = p.git?.rama ?? '?';
  const head = p.git?.ultimoCommit?.hash ?? '?sin-commits';
  const v = versionRuntime() ?? '?';
  const vs = varsenseRuntime();
  const cfg = varsenseConfigHash(p.ruta);
  return `${p.ruta}|${rama}|${head}|${v}|${vs?.version ?? 'sin-varsense'}|${cfg ?? 'sin-config'}`;
}

/* Resuelve el runtime de varsense del checkout compartido
 * (<area>/.quality-tools/varsense). [por que] 308A-1 centraliza el runtime;
 * el override de env (GLORY_VARSENSE_SOURCE_PATH) gana, igual que en
 * `entornoGate`. Devuelve null si no esta provisionado. */
function checkoutVarsense(): string | null {
  const base = process.env.GLORY_VARSENSE_SOURCE_PATH || join(RAÍZ_AREA, '.quality-tools', 'varsense');
  const cli = join(base, 'dist', 'cli', 'index.js');
  return existsSync(cli) ? base : null;
}

/* Version real de varsense (desde su package.json). null si no hay runtime. */
function varsenseRuntime(): { version: string } | null {
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
 * config cambia, el analisis de varsense cambia aunque el codigo no. */
function varsenseConfigHash(ruta: string): string | null {
  try {
    const f = join(ruta, 'varsense.config.json');
    if (!existsSync(f)) return null;
    return createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/* Ruta del bin real del runtime: node out/cli/index.js. [por que] El shim
 * `sentinel` .cmd requiere shell; usar el entry node del runtime permite
 * execFileSync sin shell (seguridad: args como array, nunca un string de
 * shell). */
function cliRuntime(): string | null {
  const v = versionRuntime();
  if (!v) return null;
  const cli = join(RAIZ_VERSIONS, v, 'out', 'cli', 'index.js');
  return existsSync(cli) ? cli : null;
}

/* [por que] Ejecutar N repos en serie no satura CPU; el detalle esta en las
 * funciones de corrida que ceden el event loop (async) y en la cola serial. */

/* Normaliza una severidad arbitraria del JSON a las 4 conocidas. */
function sev(s: unknown): SeveridadSentinel {
  const t = String(s ?? 'warning').toLowerCase();
  if (t === 'error' || t === 'warning' || t === 'information' || t === 'hint') return t;
  return 'warning';
}

/* Convierte la ruta absoluta del entry a relativa al workspace si aplica. */
function relArchivo(abs: string, raiz: string): string {
  if (!abs || !raiz) return abs;
  try {
    const rel = relative(raiz, abs);
    if (rel && !rel.startsWith('..')) return rel;
  } catch {
    /* ruta no relativizable */
  }
  return abs;
}

/* Normaliza el JSON real de `analyze` a un AnalisisSentinel plano y acotado.
 * `fuenteHallazgo` taguea cada hallazgo con la herramienta que lo emitio
 * ('sentinel' | 'varsense', fase G). */
function normalizar(
  dato: ReporteJson,
  clave: string,
  version: string,
  raiz: string,
  fuenteHallazgo: 'sentinel' | 'varsense' = 'sentinel',
): AnalisisSentinel {
  const sc = dato.severityCounts ?? {};
  const resumen = {
    error: Number(sc.error) || 0,
    warning: Number(sc.warning) || 0,
    information: Number(sc.information) || 0,
    hint: Number(sc.hint) || 0,
  };
  const hallazgos: HallazgoSentinel[] = [];
  for (const entry of dato.entries ?? []) {
    const archivo = relArchivo(String(entry.ruta ?? entry.path ?? entry.archivo ?? ''), raiz);
    for (const f of entry.findings ?? []) {
      const lineaRaw = f.range?.start?.line;
      const linea = typeof lineaRaw === 'number' ? lineaRaw : null;
      const sugerencia = typeof f.suggestion === 'string' ? f.suggestion : undefined;
      hallazgos.push({
        ruleId: String(f.ruleId ?? 'regla-desconocida'),
        mensaje: String(f.message ?? f.mensaje ?? 'sin mensaje'),
        severidad: sev(f.severity ?? f.severidad),
        archivo,
        linea,
        sugerencia,
        fuente: fuenteHallazgo,
      });
    }
  }
  const total = resumen.error + resumen.warning + resumen.information + resumen.hint;
  return {
    clave,
    version,
    fuente: 'runtime',
    estado: total > 0 ? 'conHallazgos' : 'ok',
    analizadoEn: new Date().toISOString(),
    resumen,
    hallazgos: hallazgos.slice(0, 500),
  };
}

/* Suma dos resumenes por severidad (merge de sentinel + varsense). */
function sumarResumen(a: NombreSeveridad, b: NombreSeveridad): NombreSeveridad {
  return {
    error: a.error + b.error,
    warning: a.warning + b.warning,
    information: a.information + b.information,
    hint: a.hint + b.hint,
  };
}

interface ResultadoSpawn {
  version: string;
  dato: ReporteJson;
}

/* Parseo tolerante del reporte JSON: solo es un reporte válido si hay un
 * objeto parseable en stdout. [por que] comparte la logica entre el rama de
 * exito y la de exit != 0 (ver correrSentinel). */
function parsearReporte(stdout: string | undefined): ReporteJson | null {
  if (typeof stdout !== 'string' || !stdout) return null;
  try {
    const dato = JSON.parse(stdout) as ReporteJson;
    return dato && typeof dato === 'object' ? dato : null;
  } catch {
    return null;
  }
}

/* Ejecuta el analisis real (asincrono, cede el event loop para no congelar la
 * API). [por que] el JSON va SOLO en stdout; el stderr trae logs INFO del
 * analizador que no deben romper el parseo. `sentinel analyze` sale con exit
 * != 0 cuando existen hallazgos de severidad 'error' (contrato del CLI, igual
 * que `grep`), aunque el reporte este presente y sea valido en stdout;
 * execFileAsync rechaza ante exit != 0 y en el catch hay que leer `err.stdout`.
 * Asi el estado del proyecto usa los hallazgos reales (conHallazgos) en lugar
 * de marcarlo 'error' de herramienta. Solo devuelve null si no hay stdout
 * parseable (fallo real de runtime/spawn: el llamador marca 'error'). */
const execFileAsync = promisify(execFile);
async function correrSentinel(ruta: string): Promise<ResultadoSpawn | null> {
  const cli = cliRuntime();
  if (!cli) return null;
  const version = versionRuntime() ?? '?';
  const opciones = {
    encoding: 'utf8' as const,
    windowsHide: true,
    timeout: 60000,
    env: { ...process.env, ...entornoGate() },
  };
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cli, 'analyze', '--workspace', ruta, '--format', 'json'],
      opciones,
    );
    const dato = parsearReporte(stdout);
    if (!dato) return null;
    return { version, dato };
  } catch (err) {
    const e = err as { stdout?: string };
    const dato = parsearReporte(e.stdout);
    if (!dato) return null;
    return { version, dato };
  }
}

/* Ejecuta `varsense all` si el proyecto lo declara (varsense.config.json) y
 * el runtime esta provisionado en el checkout compartido. Misma convencion
 * de exit code que sentinel: != 0 con hallazgos de severidad 'error' (el
 * reporte valido va en stdout); 2 = fallo real. Devuelve null si no aplica. */
async function correrVarsense(ruta: string): Promise<ResultadoSpawn | null> {
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
    return { version: vs.version, dato };
  } catch (err) {
    const e = err as { stdout?: string };
    const dato = parsearReporte(e.stdout);
    if (!dato) return null;
    return { version: vs.version, dato };
  }
}

/* Analiza UN proyecto, con cache por frescura (sin spawn si esta fresco) y
 * single-flight por promesa compartida: si el mismo proyecto ya se esta
 * analizando, quien lo pide espera el MISMO vuelo (nunca dos spawns a la vez
 * del mismo repo). El check+set es atomico (sin await en el medio).
 * [por que] Desde la fase G el analisis fusiona sentinel + varsense: si el
 * proyecto declara varsense y el runtime esta provisionado, ambos corren en
 * paralelo y los reportes se unen (hallazgos tagueados por fuente). Si solo
 * varsense falla, sentinel sigue valiendo y el estado varsense queda en el
 * campo `varsense` (nunca rompe el analisis). */
const enVuelo = new Map<string, Promise<AnalisisSentinel>>();
export function analizarProyecto(p: Proyecto, forzar = false): Promise<AnalisisSentinel> {
  const clave = p.clave;
  const fresco = frescoDe(p);
  const mem = cache.get(clave);
  if (!forzar && mem && mem.fresco === fresco) return Promise.resolve(mem.dato);
  const yaEnVuelo = enVuelo.get(clave);
  if (yaEnVuelo) return yaEnVuelo;
  const vuelo = (async (): Promise<AnalisisSentinel> => {
    const [res, resVs] = await Promise.all([correrSentinel(p.ruta), correrVarsense(p.ruta)]);
    let dato: AnalisisSentinel;
    if (!res) {
      dato = {
        clave,
        version: '—',
        fuente: null,
        estado: 'error',
        analizadoEn: new Date().toISOString(),
        resumen: { error: 0, warning: 0, information: 0, hint: 0 },
        hallazgos: [],
        error: 'runtime sentinel no disponible o analisis fallo',
      };
      if (resVs) {
        const vs = normalizar(resVs.dato, clave, resVs.version, p.ruta, 'varsense');
        dato.resumen = vs.resumen;
        dato.hallazgos = vs.hallazgos;
        dato.varsense = { version: resVs.version, resumen: vs.resumen };
      }
    } else {
      dato = normalizar(res.dato, clave, res.version, p.ruta, 'sentinel');
      if (resVs) {
        const vs = normalizar(resVs.dato, clave, resVs.version, p.ruta, 'varsense');
        dato.resumen = sumarResumen(dato.resumen, vs.resumen);
        dato.hallazgos = [...dato.hallazgos, ...vs.hallazgos].slice(0, 500);
        dato.varsense = { version: resVs.version, resumen: vs.resumen };
        if (dato.estado === 'ok' && vs.estado === 'conHallazgos') dato.estado = 'conHallazgos';
      }
    }
    cache.set(clave, { fresco, dato });
    persistir();
    return dato;
  })();
  enVuelo.set(clave, vuelo);
  void vuelo.finally(() => enVuelo.delete(clave));
  return vuelo;
}

/* Barrido serial del workspace: analiza solo los elegibles UNO POR UNO
 * (await), cediendo el event loop entre proyectos para no congelar la API
 * mientras corre. Rehusa lo fresco (cache) y los vuelos en curso. */
export async function analizarTodo(
  proyectos: Proyecto[],
  forzar = false,
): Promise<AnalisisSentinel[]> {
  const detalles: AnalisisSentinel[] = [];
  for (const p of proyectos.filter(esElegible)) {
    detalles.push(await analizarProyecto(p, forzar));
  }
  /* [por que] Eviccion de la cache: si un proyecto se renombra/elimina del
   * area o deja de existir en el snapshot, su entrada quedaba en memoria y en
   * data/cache/analisis.json para SIEMPRE (mapa sin eviccion = cache no
   * acotada). Se podan las claves que ya no existen hoy y se persiste una
   * sola vez tras el barrido. Sin await en el medio: check+set es atomico. */
  const vivas = new Set(proyectos.map((p) => p.clave));
  let huboPoda = false;
  for (const clave of [...cache.keys()]) {
    if (!vivas.has(clave)) {
      cache.delete(clave);
      huboPoda = true;
    }
  }
  if (huboPoda) persistir();
  return detalles;
}

/* Sirve la cache de un proyecto (para counts sin volcar hallazgos). */
export function leerAnalisis(clave: string): AnalisisSentinel | null {
  return cache.get(clave)?.dato ?? null;
}

/* Sirve TODA la cache persistida (para rehidratar el store del cliente al
 * recargar la pagina, sin volver a analizar). El cliente la pide una vez al
 * arrancar; si un proyecto aun no se analizo, simplemente no aparece. */
export function leerTodas(): AnalisisSentinel[] {
  return [...cache.values()].map((e) => e.dato);
}