/* Escritura roadmap <- TASK (20AA-10 F3): que hay que cambiar en el archivo y con quien pelea.
 * [por que] Editar en TASK y editar el roadmap son las dos cosas legitimas; lo que no puede pasar
 * es que una pise a la otra en silencio. Se comparan tres copias —el archivo, TASK y el espejo (lo
 * ultimo que el puente escribio en cada lado)— y de ahi sale la tabla del plan:
 *
 *   archivo  TASK     que se hace
 *   igual    igual    nada
 *   cambio   igual    se escribe TASK (lo hace F2)
 *   igual    cambio   se escribe el archivo
 *   cambio   cambio   gana el mas reciente; si no se puede saber, conflicto y no se escribe nada
 *
 * [por que] La comparacion es por tarea: su huella cubre solo sus lineas, asi que editar *otra*
 * tarea del mismo archivo no provoca un conflicto falso aunque cambie el mtime del fichero. */
import type { TareaRoadmap } from '../../scanner/roadmap/roadmap.js';
import {
  CLAVES_FECHA,
  contenidoDe,
  contenidoDeItem,
  espejoDeItem,
  huellaDeTarea,
  igualContenido,
  textoDeTitulo,
  type EspejoContenido,
} from './contenido-tarea.js';
import type { ItemVersionado } from '../nucleo/tipos.js';

/* Por debajo de esto, dos marcas de tiempo no dicen quien gano: el reloj del disco y el de TASK
 * no estan sincronizados al milisegundo. */
export const DESFASE_MS = 2000;

/* Un roadmap tocado hace menos de esto puede estar a medias (un agente o un editor escribiendo
 * justo ahora): se deja para la pasada siguiente. */
export const CALMA_MS = 5000;

export interface CambioArchivo {
  id: string;
  campo: string;
  antes: string | null;
  despues: string | null;
}

export interface ConflictoArchivo {
  id: string;
  motivo: string;
  archivoMs: number | null;
  tareaMs: number | null;
}

/* Una tarea del archivo que hay que reescribir, con el contenido que debe quedar. */
export interface TareaAescribir {
  t: TareaRoadmap;
  objetivo: EspejoContenido;
  cambios: CambioArchivo[];
}

export interface PlanArchivo {
  /* El archivo se toco hace un momento: no se escribe nada en esta pasada. */
  enCalma: boolean;
  escribir: boolean;
  tareas: TareaAescribir[];
  cambios: CambioArchivo[];
  conflictos: ConflictoArchivo[];
  alDia: number;
  /* Cambio el archivo y no TASK: lo escribe F2, aqui no hay nada que hacer. */
  losEscribeTask: number;
  /* Tareas de TASK sin espejo (no las escribio el puente): no se tocan. */
  sinEspejo: number;
}

export interface DepsPlanArchivo {
  tareas: TareaRoadmap[];
  enTask: ItemVersionado[];
  mtimeArchivoMs: number | null;
  ahoraMs: number;
  desfaseMs?: number;
  calmaMs?: number;
}

function texto(v: string | null | undefined): string | null {
  return v === undefined || v === null ? null : v;
}

/* El diff, campo a campo, entre lo que dice el archivo y lo que dice TASK. Es lo que va al
 * historial: «prioridad: antes -> despues», no un «se reescribio la linea». */
function diferencias(a: EspejoContenido, b: EspejoContenido, id: string): CambioArchivo[] {
  const cambios: CambioArchivo[] = [];
  const push = (campo: string, antes: string | null, despues: string | null): void => {
    if (antes !== despues) cambios.push({ id, campo, antes, despues });
  };
  push('texto', a.texto, b.texto);
  push('prioridad', a.prioridad, b.prioridad);
  push('urgencia', a.urgencia, b.urgencia);
  push('etiquetas', a.etiquetas.join(', ') || null, b.etiquetas.join(', ') || null);
  push('depende-de', a.dependeDe.join(', ') || null, b.dependeDe.join(', ') || null);
  for (const clave of CLAVES_FECHA) push(clave, texto(a.fechas[clave]), texto(b.fechas[clave]));
  return cambios;
}

/* Lo guardado en el espejo, normalizado. Null si el espejo no trae contenido utilizable (una
 * tarea espejada por una version anterior del puente): mejor no tocarla que adivinar. */
function contenidoGuardado(guardado: Record<string, unknown>): EspejoContenido | null {
  const c = guardado.espejo;
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return null;
  const o = c as Record<string, unknown>;
  if (typeof o.texto !== 'string') return null;
  const lista = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const fechas: Record<string, string> = {};
  if (typeof o.fechas === 'object' && o.fechas !== null) {
    for (const [k, v] of Object.entries(o.fechas as Record<string, unknown>)) {
      if (typeof v === 'string') fechas[k] = v;
    }
  }
  return {
    texto: o.texto,
    prioridad: typeof o.prioridad === 'string' ? o.prioridad : null,
    urgencia: typeof o.urgencia === 'string' ? o.urgencia : null,
    etiquetas: lista(o.etiquetas),
    dependeDe: lista(o.dependeDe),
    fechas,
  };
}

export function planArchivo(d: DepsPlanArchivo): PlanArchivo {
  const desfase = d.desfaseMs ?? DESFASE_MS;
  const calma = d.calmaMs ?? CALMA_MS;
  const enCalma = d.mtimeArchivoMs !== null && d.ahoraMs - d.mtimeArchivoMs < calma;

  const raices = d.enTask.filter((x) => x.item.parentId === null || x.item.parentId === undefined);
  const porId = new Map<string, ItemVersionado>();
  for (const x of raices) {
    const e = espejoDeItem(x.item);
    const id = typeof e?.id === 'string' ? e.id : null;
    if (id !== null && !porId.has(id)) porId.set(id, x);
  }

  const tareas: TareaAescribir[] = [];
  const conflictos: ConflictoArchivo[] = [];
  let alDia = 0;
  let losEscribeTask = 0;
  let sinEspejo = 0;

  for (const t of d.tareas) {
    const item = porId.get(t.id);
    if (item === undefined) continue;
    const guardado = espejoDeItem(item.item);
    if (guardado === null) continue;
    const previo = contenidoGuardado(guardado);
    if (previo === null) {
      sinEspejo += 1;
      continue;
    }
    const cambioArchivo = guardado.huella !== huellaDeTarea(t);
    const delTask = contenidoDeItem(item.item);
    const cambioTask = !igualContenido(delTask, previo);
    const delArchivo = contenidoDe(t.propiedades, textoDeTitulo(t.titulo));

    if (!cambioTask) {
      /* El archivo manda (lo haya cambiado alguien o no): TASK se pone al dia en F2. */
      if (cambioArchivo) losEscribeTask += 1;
      else alDia += 1;
      continue;
    }
    if (!cambioArchivo) {
      tareas.push({ t, objetivo: delTask, cambios: diferencias(delArchivo, delTask, t.id) });
      continue;
    }
    /* Los dos cambiaron. Si llegaron al mismo sitio, no hay nada que decidir. */
    if (igualContenido(delArchivo, delTask)) {
      alDia += 1;
      continue;
    }
    const tareaMs = Date.parse(item.updatedAt);
    const escritoEnMs = typeof guardado.escritoEn === 'string' ? Date.parse(guardado.escritoEn) : Number.NaN;
    const archivoMs = d.mtimeArchivoMs;
    const seSabe =
      archivoMs !== null &&
      Number.isFinite(tareaMs) &&
      Number.isFinite(escritoEnMs) &&
      archivoMs >= escritoEnMs &&
      Math.abs(archivoMs - tareaMs) >= desfase;
    if (!seSabe) {
      /* No se adivina: perder una edicion en silencio es peor que dejar el conflicto a la vista. */
      conflictos.push({
        id: t.id,
        motivo: 'no se sabe cual cambio despues (mtime del archivo frente a updated_at de la tarea)',
        archivoMs,
        tareaMs: Number.isFinite(tareaMs) ? tareaMs : null,
      });
      continue;
    }
    if (archivoMs > tareaMs) {
      losEscribeTask += 1;
      continue;
    }
    tareas.push({ t, objetivo: delTask, cambios: diferencias(delArchivo, delTask, t.id) });
  }

  const cambios = tareas.flatMap((x) => x.cambios);
  return {
    enCalma,
    escribir: !enCalma && tareas.length > 0,
    tareas,
    cambios,
    conflictos,
    alDia,
    losEscribeTask,
    sinEspejo,
  };
}

/* La linea de propiedades del protocolo, o null si no hay nada que decir (y entonces la linea,
 * si existe, se quita). El orden es el del protocolo, no el de llegada: dos pasadas seguidas
 * tienen que producir el mismo texto. */
export function lineaPropiedades(c: EspejoContenido): string | null {
  const pares: string[] = [];
  if (c.prioridad !== null && c.prioridad !== '') pares.push(`prioridad: ${c.prioridad}`);
  if (c.urgencia !== null && c.urgencia !== '') pares.push(`urgencia: ${c.urgencia}`);
  for (const clave of CLAVES_FECHA) {
    const v = c.fechas[clave];
    if (v !== undefined && v !== '') pares.push(`${clave}: ${v}`);
  }
  if (c.etiquetas.length > 0) pares.push(`etiquetas: ${c.etiquetas.join(', ')}`);
  if (c.dependeDe.length > 0) pares.push(`depende-de: ${c.dependeDe.join(', ')}`);
  return pares.length === 0 ? null : `  · ${pares.join(' · ')}`;
}

/* La linea de la tarea con el texto nuevo. [por que] Se conserva la forma del original —su
 * separador y el alcance de la negrita— para no reescribir de mas: si el titulo iba en negrita y
 * detras venia prosa, la prosa sigue fuera de la negrita. */
function lineaTitulo(original: string, id: string, texto: string): string {
  const m = original.match(/^([-*] \[ \] `[^`]+`\s*(?:—|–|-|:)?\s*)([\s\S]*)$/);
  const cabeza = m === null ? `- [ ] \`${id}\` — ` : m[1];
  const negrita = (m?.[2] ?? '').match(/^\*\*([\s\S]*?)\*\*([\s\S]*)$/);
  if (negrita === null) return `${cabeza}**${texto}**`;
  const cuerpo = negrita[2];
  if (cuerpo !== '' && texto.endsWith(cuerpo)) {
    return `${cabeza}**${texto.slice(0, texto.length - cuerpo.length).trimEnd()}**${cuerpo}`;
  }
  return `${cabeza}**${texto}**`;
}

/* Reescribe el texto del roadmap. [por que] Se aplica de abajo arriba: asi los numeros de linea
 * que trae el analisis siguen siendo validos mientras se toca el archivo.
 * [por que solo se toca la linea si el texto cambio] Reescribirla siempre daria pasadas que
 * cambian el archivo sin motivo (y con ellas, falsos cambios en la pasada siguiente). */
export function aplicarPlan(lineas: string[], tareas: TareaAescribir[]): string[] {
  const salida = [...lineas];
  const ordenadas = [...tareas].sort((a, b) => b.t.linea - a.t.linea);
  for (const { t, objetivo } of ordenadas) {
    const i = t.linea - 1;
    const original = salida[i];
    if (original === undefined) continue;
    if (textoDeTitulo(t.titulo) !== objetivo.texto) salida[i] = lineaTitulo(original, t.id, objetivo.texto);
    const siguiente = salida[i + 1];
    const hayProps = siguiente !== undefined && /^\s*·/.test(siguiente);
    const nueva = lineaPropiedades(objetivo);
    if (nueva === null) {
      if (hayProps) salida.splice(i + 1, 1);
      continue;
    }
    if (hayProps) salida[i + 1] = nueva;
    else salida.splice(i + 1, 0, nueva);
  }
  return salida;
}
