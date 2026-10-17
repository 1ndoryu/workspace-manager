/* Almacén del análisis por proyecto: memoria + `data/cache/analisis.json`.
 * [por qué está aparte] `analizador.ts` mezclaba la política de qué se guarda,
 * cuándo se poda y cómo se persiste con el hecho de lanzar el CLI (auditoría
 * SOLID, E3). Son dos oficios: aquí solo se guarda y se sirve. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RAIZ_AREA } from '../../../shared/rutas.js';
import type { AnalisisSentinel } from '../../../shared/types.js';

interface EntradaCache {
  fresco: string;
  dato: AnalisisSentinel;
}

/* [por que] la persistencia vive dentro del area del manager (data/cache/),
 * NO en el runtime de sentinel (solo lectura) ni en ningun proyecto real. */
function rutaPersistencia(): string {
  return join(RAIZ_AREA, 'data', 'cache', 'analisis.json');
}

/* Dueno de la cache en memoria (clave -> resultado con su frescura). */
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

/* [08AA-26] Solo un analisis valido entra en la cache. Un error es transitorio
 * (p. ej. timeout o runtime ocupado): cachearlo servia "error" en el tablero hasta
 * el siguiente forzado. Si ya habia un analisis valido, se conserva.
 * [por que] Funcion pura: se testea sin lanzar el CLI de Sentinel. */
export function esCacheable(dato: AnalisisSentinel): boolean {
  return dato.estado !== 'error';
}

/** Análisis guardado con esa misma clave de frescura, o `null`. */
export function analisisFresco(clave: string, fresco: string): AnalisisSentinel | null {
  const entrada = cache.get(clave);
  return entrada && entrada.fresco === fresco ? entrada.dato : null;
}

/** Guarda el análisis si merece guardarse; si no, deja intacto lo que hubiera. */
export function guardarAnalisis(clave: string, fresco: string, dato: AnalisisSentinel): void {
  if (!esCacheable(dato)) return;
  cache.set(clave, { fresco, dato });
  persistir();
}

/* [por que] Eviccion de la cache: si un proyecto se renombra/elimina del
 * area o deja de existir en el snapshot, su entrada quedaba en memoria y en
 * data/cache/analisis.json para SIEMPRE (mapa sin eviccion = cache no
 * acotada). Se podan las claves que ya no existen hoy y se persiste una
 * sola vez tras el barrido. */
export function podarAnalisis(vivas: Set<string>): void {
  let huboPoda = false;
  for (const clave of [...cache.keys()]) {
    if (!vivas.has(clave)) {
      cache.delete(clave);
      huboPoda = true;
    }
  }
  if (huboPoda) persistir();
}

/** Sirve la cache de un proyecto (para counts sin volcar hallazgos). */
export function leerAnalisis(clave: string): AnalisisSentinel | null {
  return cache.get(clave)?.dato ?? null;
}

/** Sirve TODA la cache persistida (para rehidratar el store del cliente al
 * recargar la pagina, sin volver a analizar). El cliente la pide una vez al
 * arrancar; si un proyecto aun no se analizo, simplemente no aparece. */
export function leerTodas(): AnalisisSentinel[] {
  return [...cache.values()].map((e) => e.dato);
}
