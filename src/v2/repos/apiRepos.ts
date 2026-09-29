/* Cliente HTTP del detalle de sync de la tab repos: habla con
 * /api/repos/detalle?clave=. [por que] Capa fina sobre axios como apiPc.ts;
 * con cache por clave en memoria para no re-pedir al plegar/desplegar (se
 * invalida con el recargar del snapshot). */
import axios from 'axios';
import type { ArchivosRepo, DetalleRepoSync } from '../../shared/types.js';

const cache = new Map<string, DetalleRepoSync>();
const cacheArchivos = new Map<string, ArchivosRepo>();

export function invalidarDetallesRepos(): void {
  cache.clear();
  cacheArchivos.clear();
}

export async function detalleRepo(clave: string): Promise<DetalleRepoSync> {
  const previo = cache.get(clave);
  if (previo) return previo;
  const { data } = await axios.get<DetalleRepoSync>('/api/repos/detalle', {
    params: { clave },
  });
  cache.set(clave, data);
  return data;
}

/* Archivos con cambios + diffs para el lateral (299A-4): misma caché por
 * clave que el detalle (se invalida con el recargar del snapshot). */
export async function archivosRepo(clave: string): Promise<ArchivosRepo> {
  const previo = cacheArchivos.get(clave);
  if (previo) return previo;
  const { data } = await axios.get<ArchivosRepo>('/api/repos/archivos', {
    params: { clave },
  });
  cacheArchivos.set(clave, data);
  return data;
}
