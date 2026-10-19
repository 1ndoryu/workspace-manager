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

/** Devuelve el snapshot: usa cache si existe, si no escanea y cachea. */
export async function obtenerSnapshot(
  raiz: string,
  escanear: () => Promise<SnapshotWorkspace>,
  forzar: boolean,
): Promise<CacheResultado> {
  const cache = rutaCache(raiz);
  if (!forzar) {
    /* Cache caliente en memoria primero: evita re-leer/parsear el JSON y
     * permite servir mutaciones recientes sin re-escaneo. */
    if (snapshotMemoria) return { snapshot: snapshotMemoria, desdeCache: true };
    const existente = leerCache(cache);
    if (existente) {
      snapshotMemoria = existente;
      return { snapshot: existente, desdeCache: true };
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
 * que devuelve la operacion (p. ej. ignorar). No re-escanea. */
export function actualizarSnapshot(snapshot: SnapshotWorkspace): void {
  snapshotMemoria = snapshot;
  escribirCache(rutaCache(snapshot.raiz), snapshot);
}
