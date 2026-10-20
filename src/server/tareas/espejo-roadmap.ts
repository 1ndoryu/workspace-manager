/* Espejo roadmap -> TASK (20AA-10 F2): plan puro de lo que hay que escribir en TASK para que
 * cada pendiente del roadmap sea una tarea, y nada mas.
 * [por que] Es puro (sin red ni disco) porque es la parte delicada: decidir si una linea del
 * roadmap ya tiene su tarea, si hay que crearla y si su contenido cambio. Con la huella de la
 * linea guardada en el payload, repetir la sincronizacion no escribe nada (idempotente) y editar
 * *otra* tarea del mismo archivo no provoca falsos cambios.
 * [gotcha] El PUT de TASK es upsert de reemplazo y su `payload` NO es opcional
 * (`src/models/productivity.rs:83`, `#[serde(default)]`): un PUT sin payload BORRA las claves
 * guardadas. Por eso el parche siempre lleva el payload entero, mezclando lo que ya hubiera
 * (menos las claves reservadas, que las fija TASK) con nuestro `roadmap`.
 * [gotcha] `parentId` solo vale si el padre es raiz y la tarea escrita no tiene hijos
 * (`src/repositories/productivity.rs:119-149`): la profundidad es 2, y por eso el padre se emite
 * antes que sus subtareas. */
import { createHash } from 'node:crypto';
import { PRIORIDADES_TAREA, URGENCIAS_TAREA } from '../../shared/tareas/tareasTab.js';
import type { PropiedadesTarea, TareaRoadmap } from '../scanner/roadmap/roadmap.js';
import type { ItemVersionado } from './nucleo/tipos.js';
import { generarIdLibre } from './sincronizar-proyectos.js';
import type { ParcheTarea } from './tarea-unitaria.js';

/* Claves que TASK fija el mismo en `payload_for_storage` (productivity.rs:92): si viajaran en
 * nuestro payload, o las pisaria el, o le impedirian deducirlas. */
const CLAVES_RESERVADAS = [
  'id',
  'texto',
  'completado',
  'prioridad',
  'urgencia',
  'proyectoId',
  'parentId',
  'orden',
] as const;

export const CLAVE_ESPEJO = 'roadmap';

/* Lo que el espejo guarda en `payload.roadmap`: el lado del archivo tal como estaba cuando el
 * puente lo escribio. F3 lo usara para saber quien cambio por ultima vez. */
export interface EspejoRoadmap {
  id: string;
  proyecto: string;
  archivo: string;
  seccion: string;
  huella: string;
  escritoEn: string;
  mtimeArchivo: string | null;
  espejo: EspejoContenido;
}

export interface EspejoContenido {
  texto: string;
  prioridad: string | null;
  urgencia: string | null;
  etiquetas: string[];
  dependeDe: string[];
  fechas: Record<string, string>;
}

export interface AccionEspejo {
  tipo: 'crear' | 'actualizar';
  /* ID del roadmap; en una subtarea, `padre#n` (las subtareas no tienen ID propio). */
  id: string;
  legacyId: number;
  parche: ParcheTarea;
  /* Por que se escribe, para el informe en seco. */
  motivo: string;
}

export interface PlanEspejo {
  acciones: AccionEspejo[];
  /* Tareas que ya estaban al dia: su huella coincide y no se toca nada. */
  alDia: number;
  /* Lo que no se puede espejar, con su motivo: nunca en silencio. */
  rechazadas: { id: string; motivo: string }[];
}

export interface DepsPlanEspejo {
  tareas: TareaRoadmap[];
  /* Tareas de la columna en TASK (GET /api/projects/:id/tasks), ya normalizadas. */
  enTask: ItemVersionado[];
  proyectoId: number;
  wmClave: string;
  archivo: string;
  seccion: string;
  mtimeArchivo: string | null;
  ahoraMs: number;
  escritura: string;
  /* IDs legacy ya ocupados en TASK (los salta el generador). */
  ocupados: Set<number>;
}

/* Texto plano de un titulo del roadmap: fuera los marcadores de negrita (en TASK el texto es
 * texto) y los espacios de mas. */
export function textoDeTitulo(titulo: string): string {
  return titulo.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

function propiedadesTexto(p: PropiedadesTarea): string {
  const pares: string[] = [];
  for (const clave of ['prioridad', 'urgencia', 'creada', 'pospuesta', 'completada'] as const) {
    const v = p[clave];
    if (v !== undefined) pares.push(`${clave}=${v}`);
  }
  if (p.etiquetas !== undefined) pares.push(`etiquetas=${p.etiquetas.join(',')}`);
  if (p.dependeDe !== undefined) pares.push(`depende-de=${p.dependeDe.join(',')}`);
  return pares.join(' ');
}

/* Huella de la tarea en el archivo: su linea y su linea de propiedades, nada mas.
 * [por que] Es lo que dice si el lado del archivo cambio desde la ultima escritura del puente. Las
 * subtareas NO entran: tienen su propia huella, y meterlas aqui haria que cambiar una subtarea
 * reescribiera al padre y le moviera el `updated_at`, que es justo lo que F3 lee para decidir
 * quien cambio por ultima vez. */
export function huellaDeTarea(t: TareaRoadmap): string {
  const partes = [textoDeTitulo(t.titulo), propiedadesTexto(t.propiedades)];
  return createHash('sha256').update(partes.join('\n'), 'utf8').digest('hex').slice(0, 16);
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

function esRaiz(item: Record<string, unknown>): boolean {
  return item.parentId === null || item.parentId === undefined;
}

function textoDeItem(item: Record<string, unknown>): string {
  return typeof item.texto === 'string' ? item.texto.trim() : '';
}

function contenidoDe(p: PropiedadesTarea, texto: string): EspejoContenido {
  const fechas: Record<string, string> = {};
  for (const clave of ['creada', 'pospuesta', 'completada'] as const) {
    const v = p[clave];
    if (v !== undefined) fechas[clave] = v;
  }
  return {
    texto,
    prioridad: p.prioridad ?? null,
    urgencia: p.urgencia ?? null,
    etiquetas: p.etiquetas ?? [],
    dependeDe: p.dependeDe ?? [],
    fechas,
  };
}

/* Elige entre lo que dice el roadmap y lo que ya tenia TASK. [por que] Si el roadmap no dice
 * nada de una propiedad, no es que diga «media»: no dice nada, y lo que hubiera en TASK se
 * respeta. Escribir un defecto encima seria pisar una edicion hecha en la app de TASK. */
function valorVigente(
  delRoadmap: string | undefined,
  enTask: unknown,
  validos: readonly string[],
): string | undefined {
  if (delRoadmap !== undefined) return delRoadmap;
  return typeof enTask === 'string' && validos.includes(enTask) ? enTask : undefined;
}

/* Plan de lo que hay que escribir. Nunca propone borrar: lo que sobra en TASK lo decide F3. */
export function planEspejo(d: DepsPlanEspejo): PlanEspejo {
  const raices = d.enTask.filter((t) => esRaiz(t.item));
  const porId = new Map<string, ItemVersionado>();
  for (const t of raices) {
    const id = idRoadmapDeItem(t.item);
    if (id !== null && !porId.has(id)) porId.set(id, t);
  }
  /* [por que] El ID es la clave del emparejado: con dos lineas iguales, las dos pelearian por la
   * misma tarea de TASK (y en la primera pasada se crearian dos). El parser ya lo reporta como
   * problema de formato; aqui no se espeja ninguna de las dos hasta que se arregle. */
  const repetidos = new Set<string>();
  const vistos = new Set<string>();
  for (const t of d.tareas) {
    if (vistos.has(t.id)) repetidos.add(t.id);
    vistos.add(t.id);
  }

  const acciones: AccionEspejo[] = [];
  const rechazadas: { id: string; motivo: string }[] = [];
  let alDia = 0;
  let orden = 0;

  for (const t of d.tareas) {
    if (repetidos.has(t.id)) {
      rechazadas.push({ id: t.id, motivo: 'ID repetido en el roadmap' });
      continue;
    }
    const texto = textoDeTitulo(t.titulo);
    if (texto === '') {
      rechazadas.push({ id: t.id, motivo: 'titulo-vacio' });
      continue;
    }
    if (texto.length > 1000) {
      rechazadas.push({ id: t.id, motivo: 'texto-demasiado-largo (tope 1000 de TASK)' });
      continue;
    }
    const huella = huellaDeTarea(t);
    const existente = porId.get(t.id) ?? null;
    const guardado = existente === null ? null : espejoDeItem(existente.item);
    if (existente !== null && guardado?.huella === huella) {
      alDia += 1;
      orden += 1;
      continue;
    }

    const legacyId = existente?.id ?? generarIdLibre(d.ocupados, d.ahoraMs);
    d.ocupados.add(legacyId);
    const item = existente?.item ?? {};
    const espejo: EspejoRoadmap = {
      id: t.id,
      proyecto: d.wmClave,
      archivo: d.archivo,
      seccion: d.seccion,
      huella,
      escritoEn: d.escritura,
      mtimeArchivo: d.mtimeArchivo,
      espejo: contenidoDe(t.propiedades, texto),
    };
    const parche: ParcheTarea = {
      texto,
      completado: false,
      proyectoId: d.proyectoId,
      parentId: null,
      orden,
      payload: { ...payloadPropio(item), [CLAVE_ESPEJO]: espejo },
      expectedUpdatedAt: existente === null ? null : (existente.updatedAt ?? null),
    };
    const prioridad = valorVigente(t.propiedades.prioridad, item.prioridad, PRIORIDADES_TAREA);
    const urgencia = valorVigente(t.propiedades.urgencia, item.urgencia, URGENCIAS_TAREA);
    if (prioridad !== undefined) parche.prioridad = prioridad;
    if (urgencia !== undefined) parche.urgencia = urgencia;

    acciones.push({
      tipo: existente === null ? 'crear' : 'actualizar',
      id: t.id,
      legacyId,
      parche,
      motivo: existente === null ? 'no existia en TASK' : `cambio en el roadmap (huella ${guardado?.huella ?? 'sin'})`,
    });
    orden += 1;

    planSubtareas(d, t, legacyId, espejo, acciones, rechazadas);
  }

  return { acciones, alDia, rechazadas };
}

/* Subtareas de una tarea ya resuelta. [por que] Van despues de su padre en la lista: TASK exige
 * que el padre exista y sea raiz antes de aceptar un `parentId`. */
function planSubtareas(
  d: DepsPlanEspejo,
  t: TareaRoadmap,
  padreLegacyId: number,
  espejoPadre: EspejoRoadmap,
  acciones: AccionEspejo[],
  rechazadas: { id: string; motivo: string }[],
): void {
  if (t.subtareas.length === 0) return;
  const hijos = d.enTask.filter((x) => x.item.parentId === padreLegacyId);
  const libres = new Set(hijos);
  for (const [i, s] of t.subtareas.entries()) {
    const etiqueta = `${t.id}#${i + 1}`;
    const texto = textoDeTitulo(s.titulo);
    if (texto === '') {
      rechazadas.push({ id: etiqueta, motivo: 'titulo-vacio' });
      continue;
    }
    /* Emparejado: por texto entre las hermanas que aun no tienen pareja (estable si se inserta
     * una subtarea en medio) y, si el texto cambio, por posicion entre las que quedan. */
    let existente = [...libres].find((x) => textoDeItem(x.item) === texto) ?? null;
    if (existente === null && i < hijos.length && libres.has(hijos[i])) existente = hijos[i];
    if (existente !== null) libres.delete(existente);

    const huella = createHash('sha256')
      .update(`${texto}\n${propiedadesTexto(s.propiedades)}`, 'utf8')
      .digest('hex')
      .slice(0, 16);
    const guardado = existente === null ? null : espejoDeItem(existente.item);
    if (existente !== null && guardado?.huella === huella) continue;

    const legacyId = existente?.id ?? generarIdLibre(d.ocupados, d.ahoraMs);
    d.ocupados.add(legacyId);
    const item = existente?.item ?? {};
    const espejo = {
      ...espejoPadre,
      id: t.id,
      huella,
      escritoEn: d.escritura,
      espejo: contenidoDe(s.propiedades, texto),
      sub: true,
      padre: t.id,
      hueco: i,
    };
    acciones.push({
      tipo: existente === null ? 'crear' : 'actualizar',
      id: etiqueta,
      legacyId,
      parche: {
        texto,
        completado: s.completada,
        proyectoId: d.proyectoId,
        parentId: padreLegacyId,
        orden: i,
        payload: { ...payloadPropio(item), [CLAVE_ESPEJO]: espejo },
        expectedUpdatedAt: existente === null ? null : (existente.updatedAt ?? null),
      },
      motivo: existente === null ? `subtarea nueva de ${t.id}` : `subtarea de ${t.id} cambiada`,
    });
  }
}
