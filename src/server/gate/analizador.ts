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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type {
  AnalisisSentinel,
  HallazgoSentinel,
  NombreSeveridad,
  Proyecto,
  SeveridadSentinel,
} from '../../shared/types.js';
import {
  RAÍZ_AREA,
  checkoutVarsense,
  cliRuntime,
  correrSentinel,
  correrVarsense,
  hashArtefacto,
  varsenseConfigHash,
  varsenseRuntime,
} from './ejecucion.js';
import type { EntryJson, FindingJson, ReporteJson } from './ejecucion.js';

/* Dueno de la cache en memoria (clave -> resultado con su frescura). */

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

/* Clave de frescura: branch + HEAD + version de sentinel + hash del artefacto
 * del runtime + (si el proyecto declara varsense) version de varsense + hash
 * de su dist + hash de su config. [por que] El analisis fusiona ambos reportes
 * (fase G): si varsense cambia de version, se reconstruye su dist, o su
 * `varsense.config.json` cambia, el resultado deja de ser fresco aunque el
 * repo y sentinel no cambien. */
function frescoDe(p: Proyecto): string {
  const rama = p.git?.rama ?? '?';
  const head = p.git?.ultimoCommit?.hash ?? '?sin-commits';
  const res = cliRuntime(p.ruta);
  const v = res?.version ?? '?';
  const vs = checkoutVarsense();
  const rSent = res ? hashArtefacto(res.cli) : '?sin-runtime';
  const rVs = vs ? hashArtefacto(join(vs, 'dist', 'cli', 'index.js')) : 'sin-varsense';
  const vr = varsenseRuntime();
  const cfg = varsenseConfigHash(p.ruta);
  return `${p.ruta}|${rama}|${head}|${v}|${rSent}|${vr?.version ?? 'sin-varsense'}|${rVs}|${cfg ?? 'sin-config'}`;
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
  commitCli: string | null = null,
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
    /* [por que] 039A-4: commit del binario que midió (solo cuando el proyecto
     * declara provisionPath propio; null = compartido/instalado o caché vieja). */
    commitCli: commitCli ?? undefined,
    fuente: 'runtime',
    estado: total > 0 ? 'conHallazgos' : 'ok',
    analizadoEn: new Date().toISOString(),
    resumen,
    /* [por que] 308A-6J11: los hallazgos se guardan COMPLETOS (sin cap 500).
     * El cap truncaba la lista y los conteos por regla del agregado no
     * coincidian con el CLI directo (p.ej. claseHuerfana de PT: 298 en la
     * consola vs 1083 reales). El render del cliente sigue siendo acotado;
     * aqui la fuente de verdad es el reporte completo. */
    hallazgos,
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
      dato = normalizar(res.dato, clave, res.version, p.ruta, 'sentinel', res.commit);
      if (resVs) {
        const vs = normalizar(resVs.dato, clave, resVs.version, p.ruta, 'varsense');
        dato.resumen = sumarResumen(dato.resumen, vs.resumen);
        dato.hallazgos = [...dato.hallazgos, ...vs.hallazgos];
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