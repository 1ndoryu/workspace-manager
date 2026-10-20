/* Sincronizacion roadmap -> TASK (20AA-10 F2): lleva cada pendiente del roadmap a su tarea de
 * TASK, con sus subtareas y en el orden del archivo.
 * [por que] El tab y el roadmap son la misma lista de trabajo: sin esto, una tarea escrita en el
 * roadmap no existe para el tablero y el trabajo abierto del area se ve a medias.
 * [que NO hace] No borra nada en TASK, no escribe en ningun archivo y no toca columnas que no
 * sean de un proyecto del workspace (`wmClave`). Lo que sobra en TASK lo decide F3, que es quien
 * puede mirar el historial antes de borrar.
 * [por que lee el archivo y no el snapshot] El snapshot puede venir de cache: para escribir en
 * TASK hay que partir del roadmap que hay ahora en el disco. */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analizarRoadmap } from '../../scanner/roadmap/roadmap.js';
import type { TareaRoadmap } from '../../scanner/roadmap/roadmap.js';
import { planEspejo, type PlanEspejo } from '../espejo-roadmap.js';
import type { PuenteTareas } from '../puente-tareas.js';
import type { ErrorKanban } from '../nucleo/tipos.js';

/* Proyecto del workspace tal como lo necesita la sincronizacion: la clave del tablero, su
 * nombre y su carpeta (de donde sale su roadmap.md). */
export interface ProyectoWm {
  clave: string;
  nombre: string;
  ruta: string;
}

export interface ResumenProyectoSync {
  proyecto: string;
  clave: string;
  /* Columna de TASK, o null si el proyecto no tiene ninguna (no se toca). */
  columna: number | null;
  pendientes: number;
  crear: number;
  actualizar: number;
  alDia: number;
  rechazadas: { id: string; motivo: string }[];
  /* Tareas que no se pudieron escribir, con el motivo (conflicto, red, validacion). */
  errores: { id: string; motivo: string }[];
  /* Se leyo el roadmap pero no se escribio nada (modo seco). */
  seco: boolean;
}

export interface InformeSync {
  seco: boolean;
  /* Roadmaps leidos, sin contar los que no tienen archivo. */
  proyectos: number;
  pendientes: number;
  crear: number;
  actualizar: number;
  alDia: number;
  /* Proyectos con roadmap y sin columna en TASK: fuera del alcance de esta obra (19AA-16). */
  sinColumna: { proyecto: string; clave: string; pendientes: number }[];
  detalle: ResumenProyectoSync[];
  ms: number;
}

export interface DepsSincronizarTareas {
  /* Puede ser sincrona: en produccion la sirve el snapshot, que ya es async, pero la firma ancha
   * evita obligar a envolver lo que ya se tiene (misma convencion que `leerWm` en las rutas). */
  proyectos: () => ProyectoWm[] | Promise<ProyectoWm[]>;
  puente: PuenteTareas;
  /* Lee el roadmap de un proyecto. Inyectable: los tests no tocan disco. */
  leerRoadmap?: (ruta: string) => { tareas: TareaRoadmap[]; mtime: string | null } | null;
  ahora?: () => number;
}

export interface OpcionesSync {
  /* En seco: calcula y cuenta, pero no escribe en TASK. */
  seco?: boolean;
}

/* Lectura real: el roadmap del disco y su mtime (lo que permitira a F3 detectar quien cambio). */
function leerRoadmapDisco(ruta: string): { tareas: TareaRoadmap[]; mtime: string | null } | null {
  const archivo = join(ruta, 'roadmap.md');
  let texto: string;
  try {
    texto = readFileSync(archivo, 'utf8');
  } catch {
    return null;
  }
  let mtime: string | null = null;
  try {
    mtime = statSync(archivo).mtime.toISOString();
  } catch {
    mtime = null;
  }
  return { tareas: analizarRoadmap(texto).tareas, mtime };
}

function motivoDe(e: unknown): string {
  const k = e as ErrorKanban | null;
  if (k !== null && typeof k === 'object' && typeof k.codigo === 'string') {
    return k.codigo === 'cuota' || k.codigo === 'servidor' ? `${k.codigo}: ${k.mensaje ?? ''}`.trim() : k.codigo;
  }
  return 'desconocido';
}

/* Aplica el plan de un proyecto. Devuelve cuantas se escribieron y que fallo. */
async function aplicar(
  puente: PuenteTareas,
  plan: PlanEspejo,
  seco: boolean,
): Promise<{ crear: number; actualizar: number; errores: { id: string; motivo: string }[] }> {
  const errores: { id: string; motivo: string }[] = [];
  let crear = 0;
  let actualizar = 0;
  for (const a of plan.acciones) {
    if (seco) {
      if (a.tipo === 'crear') crear += 1;
      else actualizar += 1;
      continue;
    }
    try {
      await puente.actualizar(a.legacyId, a.parche);
      if (a.tipo === 'crear') crear += 1;
      else actualizar += 1;
    } catch (e) {
      errores.push({ id: a.id, motivo: motivoDe(e) });
    }
  }
  return { crear, actualizar, errores };
}

/* Sincroniza todas las columnas de una pasada. En serie: TASK es un solo servicio y el orden
 * importa (el padre de una subtarea se escribe antes que ella). */
export async function sincronizarTareasRoadmap(
  deps: DepsSincronizarTareas,
  opciones: OpcionesSync = {},
): Promise<InformeSync> {
  const seco = opciones.seco === true;
  const ahora = deps.ahora ?? Date.now;
  const leer = deps.leerRoadmap ?? leerRoadmapDisco;
  const arranque = ahora();

  const proyectos = await deps.proyectos();
  const columnas = await deps.puente.proyectos();
  const porClave = new Map<string, number>();
  const ocupados = new Set<number>();
  for (const c of columnas) {
    ocupados.add(c.legacyId);
    if (c.wmClave !== null && c.wmClave !== '' && !porClave.has(c.wmClave)) porClave.set(c.wmClave, c.legacyId);
  }

  const detalle: ResumenProyectoSync[] = [];
  const sinColumna: { proyecto: string; clave: string; pendientes: number }[] = [];
  let pendientes = 0;
  let crear = 0;
  let actualizar = 0;
  let alDia = 0;
  let leidos = 0;

  for (const p of proyectos) {
    const roadmap = leer(p.ruta);
    if (roadmap === null) continue;
    leidos += 1;
    pendientes += roadmap.tareas.length;
    const columna = porClave.get(p.clave) ?? null;
    if (columna === null) {
      sinColumna.push({ proyecto: p.nombre, clave: p.clave, pendientes: roadmap.tareas.length });
      continue;
    }
    /* Las tareas de la columna, para emparejar por ID del roadmap y no duplicar. */
    const enTask = await deps.puente.listar(columna);
    for (const t of enTask) ocupados.add(t.id);
    const plan = planEspejo({
      tareas: roadmap.tareas,
      enTask,
      proyectoId: columna,
      wmClave: p.clave,
      archivo: 'roadmap.md',
      seccion: 'Pendientes',
      mtimeArchivo: roadmap.mtime,
      ahoraMs: ahora(),
      escritura: new Date(ahora()).toISOString(),
      ocupados,
    });
    const r = await aplicar(deps.puente, plan, seco);
    crear += r.crear;
    actualizar += r.actualizar;
    alDia += plan.alDia;
    detalle.push({
      proyecto: p.nombre,
      clave: p.clave,
      columna,
      pendientes: roadmap.tareas.length,
      crear: r.crear,
      actualizar: r.actualizar,
      alDia: plan.alDia,
      rechazadas: plan.rechazadas,
      errores: r.errores,
      seco,
    });
  }

  return {
    seco,
    proyectos: leidos,
    pendientes,
    crear,
    actualizar,
    alDia,
    sinColumna,
    detalle,
    ms: ahora() - arranque,
  };
}
