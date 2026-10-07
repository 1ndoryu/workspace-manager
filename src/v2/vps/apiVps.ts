/* Cliente HTTP de la tab vps: habla con /api/vps/*. [por que] Capa fina
 * sobre axios como apiRepos.ts; caches en memoria (sitios+recursos se
 * invalidan con el recargar; el detalle se cachea por sitio y tambien cae
 * con el recargar porque los datos remotos pueden haber cambiado). */
import axios from 'axios';
import type {
  VpsAgenteDetalleRespuesta,
  VpsAgenteRespuesta,
  VpsConfig,
  VpsDetalle,
  VpsHistorialSitio,
  VpsPieza,
  VpsPiezaRespuesta,
  VpsRecursos,
  VpsSitios,
} from '../../shared/types.js';
import { esMuestra, type MuestraHistorial } from '../../shared/historialVps.js';

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

/* [309A-2] Detalle por sitio en una conexión (vía agente). El llamante
 * resuelve nombre→uuid desde su lista de sitios; 0110A-3 (drill-down UI)
 * la preferirá cuando `disponible`, con `detalleVps` como fallback. */
export async function detalleAgenteVps(uuid: string): Promise<VpsAgenteDetalleRespuesta> {
  const { data } = await axios.get<VpsAgenteDetalleRespuesta>('/api/vps/agente-detalle', {
    params: { uuid },
  });
  return data;
}

/* [0110A-3 F3] Una pieza pesada bajo demanda (sin caché: cada clic es
 * fresco; el abort/timeout los pone el llamante con la señal). */
export async function piezaVps(
  sitio: string,
  pieza: string,
  opts?: { senal?: AbortSignal; objetivo?: string },
): Promise<VpsPieza> {
  const params: Record<string, string> = { sitio, pieza };
  if (opts?.objetivo) params.objetivo = opts.objetivo;
  const { data } = await axios.get<VpsPiezaRespuesta>('/api/vps/pieza', {
    params,
    signal: opts?.senal,
  });
  return data.resultado;
}

/* Snapshot del agente glory-pulse (299A-12 F3): sin caché de frontend (el
 * backend cachea 5 s). El llamante decide legacy/agente por `disponible`;
 * el error se propaga para que el poll lo trate como "sigue legacy". */
export async function agenteVps(senal?: AbortSignal): Promise<VpsAgenteRespuesta> {
  const { data } = await axios.get<VpsAgenteRespuesta>('/api/vps/agente', { signal: senal });
  return data;
}

/* [07AA-4] Base persistente del despliegue (una vez por montaje la pide el
 * hook; sin caché de módulo para no servir historia vieja al remontar).
 * Respuesta validada: lo que no sea tupla [t, cpu, mem] se descarta. */
export async function historialSitioVps(clave: string): Promise<MuestraHistorial[]> {
  const { data } = await axios.get<VpsHistorialSitio>('/api/vps/historial', {
    params: { clave },
  });
  if (!data || !Array.isArray(data.muestras)) return [];
  return data.muestras.filter(esMuestra);
}
