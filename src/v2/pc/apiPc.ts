/* Cliente HTTP de la tab PC: habla con /api/pc/* (el server es dueño del
 * binario limpiador-pc). [por que] Capa fina sobre axios como el resto de
 * acciones del store; el estado vive en el componente del panel. */
import axios from 'axios';

export type FasePc = 'area' | 'caches' | 'extern' | 'vscode' | 'chrome';

export interface EntradaPc {
  clave: string;
  ruta: string;
  bytes: number;
  detalle: string;
}

export interface MetaFase {
  fase: FasePc;
  etiqueta: string;
  descripcion: string;
  meta: {
    medidoEn: string | null;
    versionBinario: string | null;
    totalBytes: number;
    n: number;
  } | null;
}

export interface EstadoPc {
  existe: boolean;
  versionBinario: string | null;
  versionFuente: string | null;
  actualizado: boolean;
  reconstruyendo: boolean;
  fases: MetaFase[];
}

export interface ResultadoScan {
  fase: FasePc;
  entradas: EntradaPc[];
  totalBytes: number;
  medidoEn: string;
  versionBinario: string | null;
}

export interface AccionPc {
  clave: string;
  gb: number;
  estado: string;
  detalle: string;
}

export interface ResultadoLimpieza {
  fase: FasePc;
  ejecutar: boolean;
  acciones: AccionPc[];
  liberadosGb: number;
}

export async function estadoPc(): Promise<EstadoPc> {
  const { data } = await axios.get<EstadoPc>('/api/pc/estado');
  return data;
}

export async function escanearPc(fase: FasePc): Promise<ResultadoScan> {
  const { data } = await axios.post<ResultadoScan>('/api/pc/escanear', { fase });
  return data;
}

export async function limpiarPc(
  fase: FasePc,
  ejecutar: boolean,
  solo: string[],
): Promise<ResultadoLimpieza> {
  const { data } = await axios.post<ResultadoLimpieza>('/api/pc/limpiar', {
    fase,
    ejecutar,
    solo,
    ...(ejecutar ? { confirmacion: 'BORRAR' } : {}),
  });
  return data;
}

export async function reconstruirPc(): Promise<EstadoPc> {
  const { data } = await axios.post<EstadoPc>('/api/pc/reconstruir', {});
  return data;
}

/* Gibibytes con 2 decimales para tablas y resúmenes. */
export function gb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}
