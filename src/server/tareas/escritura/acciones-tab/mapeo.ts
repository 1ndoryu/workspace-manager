/* Mapeo puro de las acciones del tab sobre el roadmap (20AA-10 F3b): tipos del contrato y las
 * funciones que traducen un item de TASK a propiedades, avisos y espejos. [por que aparte] Sin E/S
 * (ni disco ni reloj) se prueba sin levantar nada; lo que lee el archivo vive en ../acciones-tab.ts. */
import type { PropiedadesTarea } from '../../../scanner/roadmap/roadmap.js';
import type { LecturaRoadmap } from '../escribir-roadmaps.js';
import { completarParche } from '../parche-completo.js';
import { espejoDeItem, payloadPropio, URGENCIA_POR_DEFECTO } from '../contenido-tarea.js';
import type { AccionTab, DepsAccionRoadmap, ProyectoRoadmap, RefSubtarea, ResultadoAccion } from '../accion-roadmap.js';
import type { EspejoRoadmap } from '../../espejo-roadmap.js';
import type { ItemVersionado } from '../../nucleo/tipos.js';
import type { PuenteTareas } from '../../puente-tareas.js';
import type { ProyectoWm } from '../../sincronizacion/sincronizar-tareas.js';
import type { ParcheTarea } from '../../tarea-unitaria.js';

export interface DepsAccionesTab {
  /* Proyectos del workspace con su carpeta (los mismos que usa el sync). */
  proyectos: () => ProyectoWm[] | Promise<ProyectoWm[]>;
  puente: PuenteTareas;
  raizRepo?: string;
  leerRoadmap?: (ruta: string) => LecturaRoadmap | null;
  ahora?: () => number;
}

/* Lo que la tab necesita saber de la accion sobre el archivo. */
export interface ResultadoTab {
  accion: AccionTab;
  proyecto: string;
  id: string | null;
  linea: number | null;
  escribio: boolean;
  /* Solo lo que la usuaria tiene que ver: un problema, no un no-op. */
  aviso: string | null;
}

export interface EscrituraTab {
  roadmap: ResultadoTab | null;
  /* Alta: el parche entero con el que repetir el PUT para grabar el espejo. */
  repetir: ParcheTarea | null;
}

export const VACIO: EscrituraTab = { roadmap: null, repetir: null };

/* Avisos de «no habia nada que hacer»: no se le cuentan a nadie. */
const BENIGNOS = new Set(['sin-cambios', 'ya-esta-en-el-roadmap', 'orden-sin-cambios']);

function aviso(r: ResultadoAccion): string | null {
  return r.aviso !== null && BENIGNOS.has(r.aviso) ? null : r.aviso;
}

export function resumen(r: ResultadoAccion): ResultadoTab {
  return { accion: r.accion, proyecto: r.proyecto, id: r.id, linea: r.linea, escribio: r.escribio, aviso: aviso(r) };
}

/* Lo que se pudo romper al reflejar una escritura que en TASK ya ocurrio. [por que no se lanza] La
 * tarjeta ya esta escrita: un 500 haria creer que no se guardo nada, y el archivo quedaria
 * desincronizado sin que nadie lo sepa. */
export function fallo(accion: AccionTab, proyecto: ProyectoRoadmap | null, id: string | null, e: unknown): ResultadoTab {
  return {
    accion,
    proyecto: proyecto?.nombre ?? '',
    id,
    linea: null,
    escribio: false,
    aviso: `roadmap-no-escrito: ${e instanceof Error ? e.message : 'desconocido'}`,
  };
}

/* Las dependencias del tab son las del driver mas dos (`proyectos` y `puente`): se pasan tal cual,
 * que el driver solo mira las suyas. */
export function depsRoadmap(deps: DepsAccionesTab): DepsAccionRoadmap {
  return deps;
}

/* Lo que TASK dice de la tarea, en propiedades del roadmap. [por que la urgencia normal no se
 * escribe] Es el valor por defecto de TASK: una tarea que nadie toco no dice «normal», no dice
 * nada, y escribirselo llenaria de ruido todas las lineas nuevas. */
export function propiedadesDeItem(item: Record<string, unknown>): PropiedadesTarea {
  const p: PropiedadesTarea = {};
  if (typeof item.prioridad === 'string' && item.prioridad !== '') p.prioridad = item.prioridad;
  if (typeof item.urgencia === 'string' && item.urgencia !== '' && item.urgencia !== URGENCIA_POR_DEFECTO) {
    p.urgencia = item.urgencia;
  }
  return p;
}

/* A que subtarea del archivo se refiere un item de TASK: por el texto y el hueco que el espejo
 * guardo la ultima vez. */
export function refDeSubtarea(item: Record<string, unknown>): RefSubtarea {
  const e = espejoDeItem(item);
  const contenido = e?.espejo;
  const texto =
    typeof contenido === 'object' && contenido !== null && typeof (contenido as Record<string, unknown>).texto === 'string'
      ? ((contenido as Record<string, unknown>).texto as string)
      : '';
  return { texto, hueco: typeof e?.hueco === 'number' ? e.hueco : null };
}

/* El parche con el que repetir el PUT de una subtarea para grabar su espejo. [por que el texto del
 * espejo] Misma razon que en el alta de una raiz: el texto de TASK tiene que ser el del archivo, o
 * la subtarea y su espejo se contradicen y la pasada siguiente reescribe la linea sin motivo. */
export function repetirSubtarea(item: ItemVersionado, espejo: EspejoRoadmap): ParcheTarea {
  return completarParche(item.item, {
    texto: espejo.espejo.texto,
    payload: { ...payloadPropio(item.item), roadmap: espejo },
  });
}
