/* Cliente HTTP del detalle de sync de la tab repos: habla con
 * /api/repos/detalle?clave=. [por que] Capa fina sobre axios como apiPc.ts;
 * con cache por clave en memoria para no re-pedir al plegar/desplegar (se
 * invalida con el recargar del snapshot). */
import axios from 'axios';
import type { DetalleRepoSync } from '../../shared/types.js';

const cache = new Map<string, DetalleRepoSync>();

export function invalidarDetallesRepos(): void {
  cache.clear();
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
