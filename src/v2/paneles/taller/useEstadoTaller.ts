/* Estado del taller remoto para el front (S3, plan sucesor 2026-10-14).
 * [por que] Store singleton con useSyncExternalStore en vez de tocar el store global: el
 * taller no es parte del workspace. Así la consola y el panel comparten una sola petición a
 * /api/taller/estado, y el sondeo corre solo mientras haya algún suscriptor (el servidor ya
 * cachea 60 s, así que no se hace SSH a la 89 por cada render). */
import { useSyncExternalStore } from 'react';
import axios from 'axios';
import type {
  EstadoLocal,
  EstadoPublico,
  EstadoTaller89,
  Hallazgo,
  RegistroConformidad,
} from '../../../shared/taller/conformidad.js';

/* Forma de la respuesta de /api/taller/estado (ver server/taller/rutasTaller.ts). */
export interface RespuestaTaller {
  tomadoEn: string;
  hallazgos: Hallazgo[];
  taller89: EstadoTaller89 | null;
  motivoSinLectura: string | null;
  publico: EstadoPublico | null;
  local: {
    procesosTotal: number;
    escuchas: EstadoLocal['escuchas'];
    mutagen: EstadoLocal['mutagen'];
    sinLectura: string | null;
  };
  registro: RegistroConformidad;
}

export interface EstadoVistaTaller {
  datos: RespuestaTaller | null;
  cargando: boolean;
  error: string | null;
}

const INTERVALO_MS = 60_000;

let estado: EstadoVistaTaller = { datos: null, cargando: false, error: null };
const oyentes = new Set<() => void>();
let temporizador: ReturnType<typeof setInterval> | null = null;
let vuelo: Promise<void> | null = null;

function emitir(cambios: Partial<EstadoVistaTaller>): void {
  estado = { ...estado, ...cambios };
  oyentes.forEach((o) => o());
}

function mensajeError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const cuerpo = err.response?.data as { error?: string; detalle?: string } | undefined;
    return cuerpo?.detalle ?? cuerpo?.error ?? err.message;
  }
  return String(err);
}

/* [por que] Una petición en vuelo a la vez: el sondeo y «recargar» no se pisan. Si «recargar»
 * llega mientras vuela una normal, se reutiliza esa (como mucho de hace unos segundos). */
function pedir(forzar: boolean): Promise<void> {
  if (vuelo) return vuelo;
  emitir({ cargando: true });
  vuelo = axios
    .get<RespuestaTaller>('/api/taller/estado', { params: forzar ? { forzar: 1 } : {} })
    .then(({ data }) => emitir({ datos: data, error: null }))
    .catch((err: unknown) => emitir({ error: mensajeError(err) }))
    .finally(() => {
      vuelo = null;
      emitir({ cargando: false });
    });
  return vuelo;
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  if (oyentes.size === 1) {
    void pedir(false);
    temporizador = setInterval(() => void pedir(false), INTERVALO_MS);
  }
  return () => {
    oyentes.delete(oyente);
    if (oyentes.size === 0 && temporizador !== null) {
      clearInterval(temporizador);
      temporizador = null;
    }
  };
}

function leer(): EstadoVistaTaller {
  return estado;
}

/* Re-evalúa saltando la caché del servidor (botón «recargar»). */
export function recargarTaller(): Promise<void> {
  return pedir(true);
}

/* Hallazgos del taller para la consola. Si la petición falla sin datos previos se avisa con
 * T0 en vez de callarlo: un fallo de lectura no es «sin problemas». */
export function hallazgosTallerDe(datos: RespuestaTaller | null, error: string | null): Hallazgo[] {
  if (datos) return datos.hallazgos;
  if (error) {
    return [{
      id: 'T0', ambito: 'local', severidad: 'advertencia',
      detalle: `no se pudo consultar el taller: ${error}`,
      remedio: 'Reintentar; si persiste, revisar el log del manager.',
    }];
  }
  return [];
}

/* Suscribirse arranca el sondeo; el último en salir lo para. */
export function useEstadoTaller(): EstadoVistaTaller {
  return useSyncExternalStore(suscribir, leer, leer);
}
