/* Cache JSON del workspace en data/cache: arranque instantaneo + re-escaneo
 * por demanda. [por que] git CLI en muchos repos es lento; el segundo arranque
 * debe servir datos del ultimo escaneo sin bloquear. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SnapshotWorkspace } from '../shared/types.js';

export interface CacheResultado {
  snapshot: SnapshotWorkspace;
  desdeCache: boolean;
}

export function leerCache(rutaCache: string): SnapshotWorkspace | null {
  if (!existsSync(rutaCache)) return null;
  try {
    const data = JSON.parse(readFileSync(rutaCache, 'utf8'));
    if (data && typeof data.raiz === 'string' && Array.isArray(data.proyectos)) {
      return data as SnapshotWorkspace;
    }
    return null;
  } catch {
    return null;
  }
}

export function escribirCache(rutaCache: string, snapshot: SnapshotWorkspace): void {
  try {
    mkdirSync(dirname(rutaCache), { recursive: true });
    writeFileSync(rutaCache, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch {
    /* cache no bloqueante: si no se puede escribir, se sirve sin cache */
  }
}

export function rutaCache(raiz: string): string {
  return join(raiz, 'data', 'cache', 'workspace.json');
}

/* Snapshot en memoria del ultimo escaneo: permite mutarlo (ignorar/quitar)
 * sin re-escandear, y sirve de cache caliente para el siguiente GET. [por
 * que] El escaneo con git es lento (8 s en frío con 21 repos en serie; ahora en
 * paralelo, ver REPOS_EN_PARALELO en scanner/workspace.ts), tras bajar a
 * dos procesos git por repo en el 17AA-2); alternar un ignorado no cambia
 * git/gate/roadmap, solo la visibilidad, asi que se muta este snapshot. */
let snapshotMemoria: SnapshotWorkspace | null = null;

/* Escaneo en curso compartido. [por que] El escaneo es asíncrono: dos peticiones con la
 * memoria vacía lanzarían dos escaneos y escribirían la caché dos veces. Quien llega
 * mientras corre espera el mismo. */
let escaneoEnCurso: Promise<CacheResultado> | null = null;

/* Vigencia del estado git dentro del snapshot servido desde cache. [por que] Pasado
 * este plazo se relee solo git (barato) y no el escaneo entero. Corto a propósito:
 * el tablero debe reflejar un commit o un cambio casi al instante. */
const VIGENCIA_GIT_MS = 30_000;

function gitCaducado(snapshot: SnapshotWorkspace): boolean {
  return Date.now() - Date.parse(snapshot.gitEn ?? snapshot.escaneadoEn) >= VIGENCIA_GIT_MS;
}

/** Devuelve el snapshot: usa cache si existe, si no escanea y cachea.
 * Con cache, si el estado git tiene más de VIGENCIA_GIT_MS, lo relee antes de servirlo. */
export async function obtenerSnapshot(
  raiz: string,
  escanear: () => Promise<SnapshotWorkspace>,
  forzar: boolean,
  refrescarGit: (snapshot: SnapshotWorkspace) => Promise<SnapshotWorkspace>,
): Promise<CacheResultado> {
  const cache = rutaCache(raiz);
  if (!forzar) {
    /* Cache caliente en memoria primero: evita re-leer/parsear el JSON y
     * permite servir mutaciones recientes sin re-escaneo. */
    const vigente = snapshotMemoria ?? leerCache(cache);
    if (vigente) {
      if (!gitCaducado(vigente)) {
        snapshotMemoria = vigente;
        return { snapshot: vigente, desdeCache: true };
      }
      const refrescado = await refrescarGit(vigente);
      actualizarSnapshot(refrescado);
      return { snapshot: refrescado, desdeCache: true };
    }
  }
  /* [por que] `finally` (asíncrono) libera el escaneo compartido aunque falle; no se
   * usa try/finally dentro de la función async porque ahí la liberación podía correr
   * antes de guardar la promesa. */
  escaneoEnCurso ??= escanear()
    .then((snapshot) => {
      snapshotMemoria = snapshot;
      escribirCache(cache, snapshot);
      return { snapshot, desdeCache: false };
    })
    .finally(() => {
      escaneoEnCurso = null;
    });
  return escaneoEnCurso;
}

/* Actualiza el snapshot cacheado (memoria + disco) con el snapshot mutado
 * que devuelve la operacion (p. ej. ignorar). No re-escanea.
 * [por que] Riesgo conocido: si hay un escaneo en curso (`escaneoEnCurso`), al
 * terminar sobrescribe memoria y disco con SU snapshot. Ese escaneo leyó la config
 * al empezar, así que puede no recoger la mutación recién hecha. El efecto es una
 * vista desfasada hasta el siguiente escaneo, no pérdida de datos: la config
 * (`data/workspace.config.json`) sí se escribe antes de mutar y el siguiente
 * escaneo la aplica. No se corrige con una bandera de generación porque el caso
 * es raro (ignorar mientras escanea) y el coste de la vista desfasada es bajo. */
export function actualizarSnapshot(snapshot: SnapshotWorkspace): void {
  snapshotMemoria = snapshot;
  escribirCache(rutaCache(snapshot.raiz), snapshot);
}
