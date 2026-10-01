/* Cliente HTTP de la tab PC: habla con /api/pc/* (el server es dueño del
 * binario limpiador-pc). [por que] Capa fina sobre axios como el resto de
 * acciones del store; el análisis global llega por SSE (EventSource) para
 * pintar cada fase en vivo, el resto es axios normal. */
import axios from 'axios';

export type FasePc = 'area' | 'caches' | 'extern' | 'vscode' | 'chrome' | 'tmp';

export interface EntradaPc {
  fase: FasePc;
  clave: string;
  ruta: string;
  bytes: number;
  detalle: string;
}

export interface ReportePc {
  entradas: EntradaPc[];
  totalBytes: number;
  medidoEn: string;
  versionBinario: string | null;
}

/* Foto del análisis en curso (para reengancharse al recargar). */
export interface AvanceScan {
  enCurso: boolean;
  preparando: boolean;
  fase: FasePc;
  etiqueta: string;
  indice: number;
  total: number;
  dir: string;
  dirs: number;
  halladas: number;
}

/* Foto del borrado en curso (para reengancharse al recargar). */
export interface AvanceLimpieza {
  enCurso: boolean;
  hechas: number;
  total: number;
}

export interface EstadoPc {
  existe: boolean;
  versionBinario: string | null;
  versionFuente: string | null;
  actualizado: boolean;
  reconstruyendo: boolean;
  reporte: ReportePc | null;
  scan: AvanceScan | null;
  limpieza: AvanceLimpieza | null;
}

export interface AccionPc {
  fase: FasePc;
  clave: string;
  gb: number;
  estado: string;
  detalle: string;
}

export interface ResultadoLimpieza {
  acciones: AccionPc[];
  liberadosGb: number;
}

export interface SeleccionPc {
  fase: FasePc;
  clave: string;
  /* Solo en el área: ruta suelta elegida (el resto filtra por clave). */
  ruta?: string;
}

export type EventoScan =
  | { tipo: 'inicio'; fase: FasePc; etiqueta: string; indice: number; total: number }
  | { tipo: 'preparando'; detalle: string }
  | { tipo: 'avance'; fase: FasePc; etiqueta: string; dir: string; dirs: number; halladas: number }
  | { tipo: 'fase'; fase: FasePc; etiqueta: string; entradas: EntradaPc[]; totalBytes: number }
  | { tipo: 'fin'; totalBytes: number; n: number; medidoEn: string; versionBinario: string | null }
  | { tipo: 'error'; fase: FasePc; etiqueta: string; detalle: string };

export type EventoLimpieza =
  | { tipo: 'inicio'; total: number }
  | { tipo: 'fase'; fase: FasePc; etiqueta: string; actual: number; total: number }
  | { tipo: 'fila'; fase: FasePc; clave: string; ruta: string; gb: number; estado: string; detalle: string }
  | { tipo: 'fin'; liberadosGb: number; eliminadas: number; fallos: number }
  | { tipo: 'error'; fase: FasePc; etiqueta: string; detalle: string };

export async function estadoPc(): Promise<EstadoPc> {
  const { data } = await axios.get<EstadoPc>('/api/pc/estado');
  return data;
}

/* Abre el análisis global por SSE; devuelve el cierre. [por que] El escaneo
 * tarda minutos: cada fase se pinta al terminar vía onEvento en vez de
 * bloquear hasta el total. */
export function escanearPcTodo(
  onEvento: (ev: EventoScan) => void,
  onError: (mensaje: string) => void,
): () => void {
  const fuente = new EventSource('/api/pc/escanear');
  fuente.addEventListener('inicio', (e) => onEvento(JSON.parse((e as MessageEvent).data) as EventoScan));
  fuente.addEventListener('preparando', (e) => onEvento(JSON.parse((e as MessageEvent).data) as EventoScan));
  fuente.addEventListener('avance', (e) => onEvento(JSON.parse((e as MessageEvent).data) as EventoScan));
  fuente.addEventListener('fase', (e) => onEvento(JSON.parse((e as MessageEvent).data) as EventoScan));
  fuente.addEventListener('fin', (e) => {
    onEvento(JSON.parse((e as MessageEvent).data) as EventoScan);
    fuente.close();
  });
  /* El evento 'error' sirve para dos casos: el evento tipado del server
   * (trae data) y el corte de conexión (sin data). */
  fuente.addEventListener('error', (e) => {
    const datos = (e as MessageEvent).data;
    if (typeof datos === 'string' && datos.length > 0) {
      onEvento(JSON.parse(datos) as EventoScan);
    } else {
      onError('se cortó el análisis');
    }
    fuente.close();
  });
  return () => fuente.close();
}

/* Abre el borrado con progreso en vivo por SSE; devuelve el cierre. Sin
 * selección se adjunta al borrado en curso (recarga a mitad). [por que]
 * EventSource solo hace GET: la selección viaja en la query como base64url
 * del JSON (las rutas traen acentos y barras que btoa pelado no acepta). */
export function limpiarPcStream(
  seleccion: SeleccionPc[] | null,
  onEvento: (ev: EventoLimpieza) => void,
  onError: (mensaje: string) => void,
): () => void {
  let url = '/api/pc/limpiar-stream?confirmacion=BORRAR';
  if (seleccion !== null) {
    const crudo = JSON.stringify(seleccion);
    const b64 = btoa(unescape(encodeURIComponent(crudo)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    url += `&sel=${b64}`;
  }
  const fuente = new EventSource(url);
  const tipos = ['inicio', 'fase', 'fila', 'fin'] as const;
  for (const t of tipos) {
    fuente.addEventListener(t, (e) => onEvento(JSON.parse((e as MessageEvent).data) as EventoLimpieza));
  }
  fuente.addEventListener('fin', () => fuente.close());
  /* El evento 'error' sirve para dos casos: el evento tipado del server
   * (trae data con el detalle) y el corte de conexión (sin data). */
  fuente.addEventListener('error', (e) => {
    const datos = (e as MessageEvent).data;
    if (typeof datos === 'string' && datos.length > 0) {
      onEvento(JSON.parse(datos) as EventoLimpieza);
    } else {
      onError('se cortó el borrado');
    }
    fuente.close();
  });
  return () => fuente.close();
}

export async function limpiarPc(seleccion: SeleccionPc[]): Promise<ResultadoLimpieza> {
  /* [por que] Antes el error de axios llegaba pelado a la UI ("Request
   * failed with status code 500") y ocultaba el detalle que el server sí
   * devuelve (qué validación falló, si hay análisis en curso, etc.). */
  try {
    const { data } = await axios.post<ResultadoLimpieza>('/api/pc/limpiar', {
      seleccion,
      confirmacion: 'BORRAR',
    });
    return data;
  } catch (err) {
    const detalle = (err as { response?: { data?: { detalle?: unknown; error?: unknown } } })?.response?.data
      ?.detalle;
    throw new Error(typeof detalle === 'string' && detalle.length > 0 ? detalle : 'falló el borrado (500)');
  }
}

export async function reconstruirPc(): Promise<EstadoPc> {
  const { data } = await axios.post<EstadoPc>('/api/pc/reconstruir', {});
  return data;
}
