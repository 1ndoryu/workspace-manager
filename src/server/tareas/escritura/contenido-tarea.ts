/* Vista unica del contenido de una tarea, compartida por las dos direcciones del espejo
 * roadmap <-> TASK (20AA-10 F2/F3).
 * [por que] El lado que escribe TASK y el que escribe el archivo tienen que comparar exactamente
 * lo mismo: si cada uno tuviera su idea de «esta tarea cambio», el uno reescribiria lo que el otro
 * acaba de dejar y la sincronizacion no pararia. Aqui vive esa vista, con las claves del payload.
 * [por que] La huella cubre la linea de la tarea y sus propiedades, nunca sus subtareas: cambiar
 * una subtarea no puede mover el `updated_at` del padre, que es justo lo que F3 lee para decidir
 * quien cambio por ultima vez. */
import { createHash } from 'node:crypto';
import type { PropiedadesTarea, TareaRoadmap } from '../../scanner/roadmap/roadmap.js';

/* Claves que TASK fija el mismo en `payload_for_storage` (PROYECTO TASKS src/repositories/
 * productivity.rs:92): si viajaran en nuestro payload, o las pisaria el, o le impedirian
 * deducirlas. */
export const CLAVES_RESERVADAS = [
  'id',
  'texto',
  'completado',
  'prioridad',
  'urgencia',
  'proyectoId',
  'parentId',
  'orden',
] as const;

/* Clave del payload donde vive el espejo: lo que el puente sabe del lado del archivo. */
export const CLAVE_ESPEJO = 'roadmap';

/* El contenido de una tarea, igual visto desde el archivo que desde TASK. */
export interface EspejoContenido {
  texto: string;
  prioridad: string | null;
  urgencia: string | null;
  etiquetas: string[];
  dependeDe: string[];
  /* Fechas por su nombre en el roadmap: `creada`, `pospuesta`, `completada`. */
  fechas: Record<string, string>;
}

export const CLAVES_FECHA = ['creada', 'pospuesta', 'completada'] as const;

/* Urgencia por defecto de TASK (`default_urgency`, PROYECTO TASKS src/models/productivity.rs:229):
 * su `urgencia` es un `String` con `#[serde(default)]`, asi que un PUT que no la manda guarda
 * «normal» y el GET la devuelve. [por que] Se trata como «no dicha» en los dos lados: si no, TASK
 * pareceria haber cambiado en cada tarea (normal frente a ausente) y F3 escribiria `urgencia:
 * normal` en las 198 lineas del area, que es justo el engorde que el plan evita. Lo ausente y el
 * valor por defecto son lo mismo. */
export const URGENCIA_POR_DEFECTO = 'normal';

/* Un valor de TASK o del archivo que vale lo mismo que no decir nada. */
function dicho(v: string | null | undefined): string | null {
  if (v === undefined || v === null || v === '') return null;
  return v === URGENCIA_POR_DEFECTO ? null : v;
}

/* Texto plano de un titulo del roadmap: fuera los marcadores de negrita (en TASK el texto es
 * texto) y los espacios de mas. */
export function textoDeTitulo(titulo: string): string {
  return titulo.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

/* El mismo texto sin el punto final. [por que] El punto es formato del protocolo —`lineasDeTarea`
 * lo pone al escribir y `tituloCanonico` lo quita—, no texto de la tarea: el archivo lo lleva y
 * TASK puede no llevarlo. Compararlos tal cual daba dos fallos medidos en F4: una entrada de
 * historial falsa por tarea creada (el texto «cambiaba» sin que nadie lo tocara, en cada pasada) y
 * un conflicto permanente tras editar desde el tab (los dos lados cambiaron a lo mismo, pero uno
 * con punto y el otro sin el). */
export function sinPuntoFinal(texto: string): string {
  return texto.replace(/\.+$/, '').trimEnd();
}

/* Las propiedades en una sola cadena, en el orden fijo del protocolo: es lo que se resume en la
 * huella y lo que hace comparables dos lecturas del mismo archivo. */
function propiedadesTexto(p: PropiedadesTarea): string {
  const pares: string[] = [];
  for (const clave of ['prioridad', 'urgencia', ...CLAVES_FECHA] as const) {
    const v = p[clave];
    if (v !== undefined) pares.push(`${clave}=${v}`);
  }
  if (p.etiquetas !== undefined) pares.push(`etiquetas=${p.etiquetas.join(',')}`);
  if (p.dependeDe !== undefined) pares.push(`depende-de=${p.dependeDe.join(',')}`);
  return pares.join(' ');
}

/* Huella de una linea del roadmap: su texto y sus propiedades, nada mas. */
export function huellaDeTexto(texto: string, p: PropiedadesTarea): string {
  return createHash('sha256').update(`${texto}\n${propiedadesTexto(p)}`, 'utf8').digest('hex').slice(0, 16);
}

/* Huella de la tarea en el archivo: su linea y su linea de propiedades. */
export function huellaDeTarea(t: TareaRoadmap): string {
  return huellaDeTexto(textoDeTitulo(t.titulo), t.propiedades);
}

/* El contenido tal como lo dice el roadmap. */
export function contenidoDe(p: PropiedadesTarea, texto: string): EspejoContenido {
  const fechas: Record<string, string> = {};
  for (const clave of CLAVES_FECHA) {
    const v = p[clave];
    if (v !== undefined) fechas[clave] = v;
  }
  return {
    texto,
    prioridad: dicho(p.prioridad),
    urgencia: dicho(p.urgencia),
    etiquetas: p.etiquetas ?? [],
    dependeDe: p.dependeDe ?? [],
    fechas,
  };
}

function lista(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : [];
}

/* El mismo contenido visto desde TASK. [por que] Etiquetas, dependencias y fechas no existen en
 * TASK: el puente las guarda como claves propias de su payload, y aqui se leen de ahi. */
export function contenidoDeItem(item: Record<string, unknown>): EspejoContenido {
  const fechas: Record<string, string> = {};
  for (const clave of CLAVES_FECHA) {
    const v = item[clave];
    if (typeof v === 'string' && v !== '') fechas[clave] = v;
  }
  return {
    texto: typeof item.texto === 'string' ? item.texto.trim() : '',
    prioridad: dicho(typeof item.prioridad === 'string' ? item.prioridad : null),
    urgencia: dicho(typeof item.urgencia === 'string' ? item.urgencia : null),
    etiquetas: lista(item.etiquetas),
    dependeDe: lista(item.dependeDe),
    fechas,
  };
}

function iguales(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

/* Dos contenidos son el mismo. [por que] Las listas se comparan sin orden: en TASK el orden de
 * una etiqueta no significa nada, y compararlas tal cual daria cambios falsos en cada pasada. El
 * texto se compara sin el punto final de la linea, que es formato y no texto (`sinPuntoFinal`). */
export function igualContenido(a: EspejoContenido, b: EspejoContenido): boolean {
  if (sinPuntoFinal(a.texto) !== sinPuntoFinal(b.texto) || a.prioridad !== b.prioridad || a.urgencia !== b.urgencia) return false;
  if (!iguales(a.etiquetas, b.etiquetas) || !iguales(a.dependeDe, b.dependeDe)) return false;
  const claves = new Set([...Object.keys(a.fechas), ...Object.keys(b.fechas)]);
  for (const k of claves) if (a.fechas[k] !== b.fechas[k]) return false;
  return true;
}

/* Lo que el item de TASK trae de payload propio: todo menos las claves que TASK fija y nuestro
 * espejo. Es lo que hay que devolverle en el PUT para no borrarselo. */
export function payloadPropio(item: Record<string, unknown>): Record<string, unknown> {
  const propio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if ((CLAVES_RESERVADAS as readonly string[]).includes(k)) continue;
    if (k === CLAVE_ESPEJO) continue;
    propio[k] = v;
  }
  return propio;
}

/* Espejo guardado en un item, o null si la tarea no la creo el puente. */
export function espejoDeItem(item: Record<string, unknown>): Record<string, unknown> | null {
  const v = item[CLAVE_ESPEJO];
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/* ID del roadmap que el item declara, o null si la tarea no viene del roadmap. */
export function idRoadmapDeItem(item: Record<string, unknown>): string | null {
  const e = espejoDeItem(item);
  const id = e?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}
