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
    if (data && Array.isArray(data.proyectos)) {
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

/** Devuelve el snapshot: usa cache si existe, si no escanea y cachea. */
export function obtenerSnapshot(
  raiz: string,
  escanear: () => SnapshotWorkspace,
  forzar: boolean,
): CacheResultado {
  const cache = rutaCache(raiz);
  if (!forzar) {
    const existente = leerCache(cache);
    if (existente) return { snapshot: existente, desdeCache: true };
  }
  const snapshot = escanear();
  escribirCache(cache, snapshot);
  return { snapshot, desdeCache: false };
}
