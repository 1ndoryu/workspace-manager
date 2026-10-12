/* Cliente HTTP de la pestaña Guardián: habla con /api/guardian/*.
 * [por que] validateStatus siempre true: 409 y 422 traen en el cuerpo el motivo y
 * el resumen por proyecto que la página muestra; axios no debe lanzar por ellos. */
import axios from 'axios';
import type {
  CambioPolitica,
  CambioTopes,
  EstadoArea,
  EstadoProyecto,
  HashesTopes,
  LecturaPlantilla,
  PlantillaDatos,
  ProyectoSinGuardian,
  RespuestaEdicion,
  RespuestaLote,
  RespuestaTopes,
  ResultadoMantenimiento,
  ResultadoProbar,
} from './tiposGuardian.js';

export interface ErrorServidor {
  error: string;
  detalle?: string;
}

export interface Respuesta<T> {
  status: number;
  data: T | ErrorServidor;
}

/* Procesos del guard pueden tardar: probar acota a 5 s y mantenimiento a 60 s. */
const TIMEOUT_MANTENIMIENTO = 70_000;

async function get<T>(ruta: string, params?: Record<string, string | number | undefined>): Promise<Respuesta<T>> {
  const { status, data } = await axios.get<T | ErrorServidor>(ruta, { params, validateStatus: () => true });
  return { status, data };
}

async function post<T>(ruta: string, cuerpo: object, timeout?: number): Promise<Respuesta<T>> {
  const { status, data } = await axios.post<T | ErrorServidor>(ruta, cuerpo, {
    validateStatus: () => true,
    timeout,
  });
  return { status, data };
}

/* Texto para la página cuando la respuesta no es la esperada. Los errores del
 * router traen `error`; las respuestas de edición, `motivo`. */
export function motivoDe(data: unknown): string {
  if (typeof data !== 'object' || data === null) return 'respuesta no válida';
  const { motivo, error } = data as { motivo?: unknown; error?: unknown };
  if (typeof motivo === 'string') return motivo;
  if (typeof error === 'string') return error;
  return 'respuesta no válida';
}

/* Para lecturas: un estado distinto de 200 es un fallo con su motivo. */
export function leerOk<T>(r: Respuesta<T>): T {
  if (r.status !== 200) throw new Error(motivoDe(r.data));
  return r.data as T;
}

/* [por que] Una edición devuelve su resultado tipado también con 409 y 422
 * (estado conflicto|error). Lo que no lleva `estado` (400, 403, 415, 500) es un
 * fallo de la petición y se lanza con su motivo. */
export function resultadoEdicion<T extends { estado: string }>(r: Respuesta<T>): T {
  const d = r.data;
  if (typeof d === 'object' && d !== null && 'estado' in d) return d as T;
  /* Sin `estado` no es una respuesta de edición: es un fallo de la petición. */
  throw new Error(motivoDe(d));
}

/* --- Lecturas ----------------------------------------------------------------- */

export function estadoArea(): Promise<Respuesta<EstadoArea>> {
  return get<EstadoArea>('/api/guardian/estado-todo');
}

/* 200 con `elegible: false` si el proyecto no tiene puerta sentinel; 404 si no existe. */
export function estadoProyecto(clave: string): Promise<Respuesta<EstadoProyecto | ProyectoSinGuardian>> {
  return get<EstadoProyecto | ProyectoSinGuardian>('/api/guardian/estado', { clave });
}

export function verPlantilla(): Promise<Respuesta<LecturaPlantilla>> {
  return get<LecturaPlantilla>('/api/guardian/plantilla');
}

/* --- Escrituras (sin `confirmar` es vista previa; con `confirmar: true` escribe) -- */

export interface CuerpoPolitica {
  clave: string;
  hashPrevio: string;
  cambio: CambioPolitica;
  confirmar?: boolean;
}

export function editarPolitica(cuerpo: CuerpoPolitica): Promise<Respuesta<RespuestaEdicion>> {
  return post<RespuestaEdicion>('/api/guardian/politica', cuerpo);
}

export interface CuerpoTopes {
  clave: string;
  hashes: HashesTopes;
  cambio: CambioTopes;
  confirmar?: boolean;
}

export function editarTopes(cuerpo: CuerpoTopes): Promise<Respuesta<RespuestaTopes>> {
  return post<RespuestaTopes>('/api/guardian/topes', cuerpo);
}

export interface EntradaLote {
  clave: string;
  hashPrevio: string;
  cambio: CambioPolitica;
}

export function editarLote(entradas: EntradaLote[], confirmar: boolean): Promise<Respuesta<RespuestaLote>> {
  return post<RespuestaLote>('/api/guardian/lote', { entradas, confirmar });
}

export interface CuerpoPlantilla {
  hashPrevio: string;
  plantilla: PlantillaDatos;
  confirmar?: boolean;
}

export function editarPlantilla(cuerpo: CuerpoPlantilla): Promise<Respuesta<RespuestaEdicion>> {
  return post<RespuestaEdicion>('/api/guardian/plantilla', cuerpo);
}

/* --- Operación ---------------------------------------------------------------- */

export interface CuerpoProbar {
  clave: string;
  ejecutable: string;
  args: string[];
}

export function probarComando(cuerpo: CuerpoProbar): Promise<Respuesta<ResultadoProbar>> {
  return post<ResultadoProbar>('/api/guardian/probar', cuerpo, 10_000);
}

export interface CuerpoMantenimiento {
  conShims?: boolean;
  conPerfiles?: boolean;
  confirmar?: boolean;
}

export function ejecutarMantenimiento(cuerpo: CuerpoMantenimiento): Promise<Respuesta<ResultadoMantenimiento>> {
  return post<ResultadoMantenimiento>('/api/guardian/mantenimiento', cuerpo, TIMEOUT_MANTENIMIENTO);
}
