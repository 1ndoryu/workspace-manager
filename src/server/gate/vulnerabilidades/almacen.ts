/* Almacén de vulnerabilidades por proyecto: memoria + `data/cache/vulnerabilidades.json`.
 * [por qué existe] La caché vivía SOLO en memoria (`vulnerabilidades.ts`), así que
 * cada reinicio del backend la tiraba y el tablero perdía sus 53 entradas de
 * `vulnerabilidad` **en silencio**: el contador bajaba sin que nada estuviera más
 * limpio. Es el mismo defecto que ya se corrigió para el análisis de Sentinel; se
 * resuelve igual, con el mismo dueño para «qué se guarda» y «cómo se persiste».
 * [por qué está aparte] `vulnerabilidades.ts` sabe auditar (lanzar cargo-audit/npm
 * audit y agregar); esto solo sabe guardar y servir. Son dos oficios. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RAIZ_AREA } from '../../../shared/rutas.js';
import type { AnalisisVulnerabilidades } from '../../../shared/types.js';

interface EntradaCache {
  fresco: string;
  dato: AnalisisVulnerabilidades;
}

/* [por que] la persistencia vive dentro del area del manager (data/cache/),
 * NO en el runtime de las herramientas ni en ningun proyecto real. */
function rutaPersistencia(): string {
  return join(RAIZ_AREA, 'data', 'cache', 'vulnerabilidades.json');
}

/* Dueño de la cache en memoria (clave -> resultado con su frescura). */
const cache = new Map<string, EntradaCache>();

/* Carga la cache persistida al arranque (arranque instantaneo, y el tablero no
 * pierde el conteo al reiniciar). */
try {
  const obj = JSON.parse(readFileSync(rutaPersistencia(), 'utf8')) as Record<string, EntradaCache>;
  for (const k of Object.keys(obj)) cache.set(k, obj[k]);
} catch {
  /* sin cache persistido: arranca vacio, no es error. */
}

/* Persiste la cache en disco (best-effort: no debe tumbar la auditoria). */
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

/* [por que] Solo un análisis válido entra en la caché. `error` es transitorio
 * (cargo-audit ausente, timeout, la 89 ocupada): guardarlo servía «error» en el
 * tablero hasta el siguiente forzado, y encima el conteo caía a cero sin avisar.
 * `noAuditable` SÍ se guarda: es un hecho estable del proyecto (no tiene lockfile),
 * y re-detectarlo en cada arranque es trabajo repetido. Función pura: se testea
 * sin lanzar ninguna herramienta. */
export function esCacheable(dato: AnalisisVulnerabilidades): boolean {
  return dato.estado !== 'error';
}

/** Resultado guardado con esa misma clave de frescura, o `null`. */
export function vulnerabilidadesFrescas(clave: string, fresco: string): AnalisisVulnerabilidades | null {
  const entrada = cache.get(clave);
  return entrada && entrada.fresco === fresco ? entrada.dato : null;
}

/** Guarda el resultado si merece guardarse; si no, deja intacto lo que hubiera. */
export function guardarVulnerabilidades(clave: string, fresco: string, dato: AnalisisVulnerabilidades): void {
  if (!esCacheable(dato)) return;
  cache.set(clave, { fresco, dato });
  persistir();
}

/** Evicción: las claves que ya no existen en el snapshot se podan, o el fichero
 * crece para siempre. Se persiste una sola vez tras el barrido. */
export function podarVulnerabilidades(vivas: Set<string>): void {
  let huboPoda = false;
  for (const clave of [...cache.keys()]) {
    if (!vivas.has(clave)) {
      cache.delete(clave);
      huboPoda = true;
    }
  }
  if (huboPoda) persistir();
}

/** Sirve la caché de un proyecto (para counts sin volcar hallazgos). */
export function leerVulnerabilidades(clave: string): AnalisisVulnerabilidades | null {
  return cache.get(clave)?.dato ?? null;
}

/** Sirve TODA la caché (rehidratar el store al recargar sin re-auditar). */
export function leerTodasVulnerabilidades(): AnalisisVulnerabilidades[] {
  return [...cache.values()].map((e) => e.dato);
}
