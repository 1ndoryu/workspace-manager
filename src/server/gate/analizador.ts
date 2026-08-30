/* Analizador real de sentinel por proyecto (plan analisis-sentinel-consola A0).
 * [por que] La consola debe reportar los hallazgos reales que `sentinel
 * analyze` detecta en cada repo SIN consumir recursos. Para eso este modulo:
 *  - corre `sentinel analyze --workspace <ruta> --format json` (una sola vez por
 *    cambio real), nunca dentro del escaneo raiz (~2.6 s) que vive aparte;
 *  - cachea por frescura = branch + HEAD + version de sentinel: si el repo no
 *    cambio y sentinel no cambio, se sirve cacheado sin volver a spawn;
 *  - es eligibilidad por puerta ('sentinel'), salta carpetas/cargo;
 *  - usa execFileSync sin shell (mismo patron que doctorSentinel), con timeout
 *    y salida acotada; ante fallo marca 'error' y NUNCA rompe el snapshot.
 * El cliente es 'tonto': pide y muestra; este modulo es el dueno de la ejecucion. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type {
  AnalisisSentinel,
  HallazgoSentinel,
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

/* Solo los proyectos cuyo gate real es sentinel (carpetas/cargo no aplican). */
export function esElegible(p: Proyecto): boolean {
  return p.gate?.puerta === 'sentinel';
}

/* Clave de frescura: branch + HEAD + version de sentinel. Si cualquiera
 * cambia, se re-analiza; si no, la cache sirve sin spawn. */
function frescoDe(p: Proyecto): string {
  const rama = p.git?.rama ?? '?';
  const head = p.git?.ultimoCommit?.hash ?? '?sin-commits';
  const v = versionRuntime() ?? '?';
  return `${p.ruta}|${rama}|${head}|${v}`;
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

/* Normaliza el JSON real de `analyze` a un AnalisisSentinel plano y acotado. */
function normalizar(
  dato: ReporteJson,
  clave: string,
  version: string,
  raiz: string,
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

interface ResultadoSpawn {
  version: string;
  dato: ReporteJson;
}

/* Ejecuta el analisis real (sincrono, bloqueante a proposito: ejecutar N repos
 * en serie no satura CPU). [por que] el JSON va SOLO en stdout; el stderr trae
 * logs INFO del analizador que no deben romper el parseo. */
function correrSentinel(ruta: string): ResultadoSpawn | null {
  const cli = cliRuntime();
  if (!cli) return null;
  try {
    const out = execFileSync(
      process.execPath,
      [cli, 'analyze', '--workspace', ruta, '--format', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true },
    );
    const dato = JSON.parse(out) as ReporteJson;
    if (!dato || typeof dato !== 'object') return null;
    return { version: versionRuntime() ?? '?', dato };
  } catch {
    return null;
  }
}

/* Analiza UN proyecto y devuelve su AnalisisSentinel, con cache por frescura:
 * si esta fresco lo sirve sin spawn. [por que] el vuelo (enVuelo) evita
 * re-analizar el mismo repo dos veces dentro del mismo barrido; la cola serial
 * se cumple sola al usar execFileSync (bloquea el event loop). */
const enVuelo = new Set<string>();
export function analizarProyecto(p: Proyecto, forzar = false): AnalisisSentinel {
  const clave = p.clave;
  const fresco = frescoDe(p);
  const mem = cache.get(clave);
  if (!forzar && mem && mem.fresco === fresco) return mem.dato;
  if (enVuelo.has(clave) && mem) return mem.dato;
  enVuelo.add(clave);
  try {
    const res = correrSentinel(p.ruta);
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
    } else {
      dato = normalizar(res.dato, clave, res.version, p.ruta);
    }
    cache.set(clave, { fresco, dato });
    persistir();
    return dato;
  } finally {
    enVuelo.delete(clave);
  }
}

/* Barrido serial del workspace: analiza solo los elegibles y devuelve los
 * resultados (rehusa lo fresco; execFileSync hace la cola serial). */
export function analizarTodo(proyectos: Proyecto[], forzar = false): AnalisisSentinel[] {
  return proyectos.filter(esElegible).map((p) => analizarProyecto(p, forzar));
}

/* Sirve la cache de un proyecto (para counts sin volcar hallazgos). */
export function leerAnalisis(clave: string): AnalisisSentinel | null {
  return cache.get(clave)?.dato ?? null;
}