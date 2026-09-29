/* Cliente HTTP de la tab vps: habla con /api/vps/*. [por que] Capa fina
 * sobre axios como apiRepos.ts; caches en memoria (sitios+recursos se
 * invalidan con el recargar; el detalle se cachea por sitio y tambien cae
 * con el recargar porque los datos remotos pueden haber cambiado). */
import axios from 'axios';
import type { VpsConfig, VpsDetalle, VpsRecursos, VpsSitios } from '../../shared/types.js';

let cacheSitios: VpsSitios | null = null;
let cacheRecursos: VpsRecursos | null = null;
const cacheDetalle = new Map<string, VpsDetalle>();
let cacheConfig: VpsConfig | null = null;

export function invalidarVps(): void {
  cacheSitios = null;
  cacheRecursos = null;
  cacheDetalle.clear();
}

export async function configVps(): Promise<VpsConfig> {
  if (cacheConfig) return cacheConfig;
  const { data } = await axios.get<VpsConfig>('/api/vps/config');
  cacheConfig = data;
  return data;
}

export async function sitiosVps(): Promise<VpsSitios> {
  if (cacheSitios) return cacheSitios;
  const { data } = await axios.get<VpsSitios>('/api/vps/sitios');
  cacheSitios = data;
  return data;
}

export async function recursosVps(): Promise<VpsRecursos> {
  if (cacheRecursos) return cacheRecursos;
  const { data } = await axios.get<VpsRecursos>('/api/vps/recursos');
  cacheRecursos = data;
  return data;
}

export async function detalleVps(sitio: string): Promise<VpsDetalle> {
  const previo = cacheDetalle.get(sitio);
  if (previo) return previo;
  const { data } = await axios.get<VpsDetalle>('/api/vps/detalle', { params: { sitio } });
  cacheDetalle.set(sitio, data);
  return data;
}
