/* Driver de la escritura roadmap <- TASK (20AA-10 F3): lo que se edita en el tab o en la app de
 * TASK acaba en el archivo, con copia previa y rastro.
 * [por que] Solo se escribe el `roadmap.md` del propio proyecto, y solo cuando la tarea ya existe
 * en los dos lados: crear, borrar, cerrar y cruzar de columna son F3b, que necesitan repartir IDs
 * del puente. Aqui no se crea un `roadmap.md` que no exista ni se toca `.git`. */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_REPO } from '../../plataforma/rutas.js';
import { analizarRoadmap, type TareaRoadmap } from '../../scanner/roadmap/roadmap.js';
import { apuntarHistorial, copiaPrevia, escribirAtomico, hashTexto, type EntradaHistorial } from './escritura-roadmap.js';
import { aplicarPlan, planArchivo, type ConflictoArchivo } from './plan-archivo.js';
import type { PuenteTareas } from '../puente-tareas.js';
import type { ProyectoWm } from '../sincronizacion/sincronizar-tareas.js';

export interface LecturaRoadmap {
  texto: string;
  mtimeMs: number | null;
  tareas: TareaRoadmap[];
}

export interface ResumenProyectoArchivo {
  proyecto: string;
  clave: string;
  columna: number | null;
  cambios: number;
  conflictos: number;
  alDia: number;
  /* Cambio el archivo: lo escribe F2, aqui no se toca. */
  losEscribeTask: number;
  sinEspejo: number;
  enCalma: boolean;
  escribio: boolean;
  copia: string | null;
  errores: { id: string; motivo: string }[];
}

export interface InformeArchivo {
  seco: boolean;
  proyectos: number;
  cambios: number;
  conflictos: number;
  /* Los conflictos, con su proyecto: nunca en silencio. */
  avisos: (ConflictoArchivo & { proyecto: string; clave: string })[];
  escribio: number;
  detalle: ResumenProyectoArchivo[];
  ms: number;
}

export interface DepsEscribirRoadmaps {
  proyectos: () => ProyectoWm[] | Promise<ProyectoWm[]>;
  puente: PuenteTareas;
  raizRepo?: string;
  /* Inyectables: los tests no tocan disco ni red. */
  leerRoadmap?: (ruta: string) => LecturaRoadmap | null;
  ahora?: () => number;
}

function leerDelDisco(ruta: string): LecturaRoadmap | null {
  const archivo = join(ruta, 'roadmap.md');
  let texto: string;
  let mtimeMs: number | null = null;
  try {
    texto = readFileSync(archivo, 'utf8');
    mtimeMs = statSync(archivo).mtimeMs;
  } catch {
    return null;
  }
  return { texto, mtimeMs, tareas: analizarRoadmap(texto).tareas };
}

function partir(texto: string): { lineas: string[]; eol: string } {
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  return { lineas: texto.split(eol), eol };
}

/* Escribe un proyecto: copia, texto nuevo, verificacion y rastro. */
function escribirProyecto(
  raizRepo: string,
  proyecto: ProyectoWm,
  archivo: string,
  lectura: LecturaRoadmap,
  plan: ReturnType<typeof planArchivo>,
  ahora: Date,
): { copia: string; entradas: EntradaHistorial[] } {
  const { ruta } = copiaPrevia(raizRepo, proyecto.clave, archivo, lectura.texto, ahora);
  const { lineas, eol } = partir(lectura.texto);
  const nuevo = aplicarPlan(lineas, plan.tareas).join(eol);
  escribirAtomico(archivo, nuevo, hashTexto(lectura.texto));
  const at = ahora.toISOString();
  const entradas: EntradaHistorial[] = [];
  for (const t of plan.tareas) {
    for (const c of t.cambios) {
      entradas.push({
        at,
        tarea: c.id,
        origen: 'task',
        campo: c.campo,
        antes: c.antes,
        despues: c.despues,
        sitio: `roadmap.md:${t.t.linea}`,
        autor: 'puente',
      });
    }
  }
  for (const c of plan.conflictos) {
    entradas.push({
      at,
      tarea: c.id,
      origen: 'conflicto',
      campo: 'sin-resolver',
      antes: null,
      despues: null,
      sitio: null,
      autor: 'puente',
    });
  }
  if (entradas.length > 0) apuntarHistorial(raizRepo, proyecto.clave, entradas);
  return { copia: ruta, entradas };
}

export async function escribirRoadmaps(
  deps: DepsEscribirRoadmaps,
  opciones: { seco?: boolean } = {},
): Promise<InformeArchivo> {
  const seco = opciones.seco === true;
  const raizRepo = deps.raizRepo ?? RAIZ_REPO;
  const ahora = deps.ahora ?? Date.now;
  const leer = deps.leerRoadmap ?? leerDelDisco;
  const arranque = ahora();

  const proyectos = await deps.proyectos();
  const columnas = await deps.puente.proyectos();
  const porClave = new Map<string, number>();
  for (const c of columnas) {
    if (c.wmClave !== null && c.wmClave !== '' && !porClave.has(c.wmClave)) porClave.set(c.wmClave, c.legacyId);
  }

  const detalle: ResumenProyectoArchivo[] = [];
  const avisos: (ConflictoArchivo & { proyecto: string; clave: string })[] = [];
  let cambios = 0;
  let conflictos = 0;
  let escribio = 0;
  let leidos = 0;

  for (const p of proyectos) {
    const lectura = leer(p.ruta);
    if (lectura === null) continue;
    leidos += 1;
    const columna = porClave.get(p.clave) ?? null;
    if (columna === null) continue;
    const resumen: ResumenProyectoArchivo = {
      proyecto: p.nombre,
      clave: p.clave,
      columna,
      cambios: 0,
      conflictos: 0,
      alDia: 0,
      losEscribeTask: 0,
      sinEspejo: 0,
      enCalma: false,
      escribio: false,
      copia: null,
      errores: [],
    };
    try {
      const enTask = await deps.puente.listar(columna);
      const plan = planArchivo({
        tareas: lectura.tareas,
        enTask,
        mtimeArchivoMs: lectura.mtimeMs,
        ahoraMs: ahora(),
      });
      resumen.cambios = plan.cambios.length;
      resumen.conflictos = plan.conflictos.length;
      resumen.alDia = plan.alDia;
      resumen.losEscribeTask = plan.losEscribeTask;
      resumen.sinEspejo = plan.sinEspejo;
      resumen.enCalma = plan.enCalma;
      for (const c of plan.conflictos) avisos.push({ ...c, proyecto: p.nombre, clave: p.clave });
      cambios += plan.cambios.length;
      conflictos += plan.conflictos.length;
      if (plan.escribir && !seco) {
        const r = escribirProyecto(raizRepo, p, join(p.ruta, 'roadmap.md'), lectura, plan, new Date(ahora()));
        resumen.escribio = true;
        resumen.copia = r.copia;
        escribio += 1;
      }
    } catch (e) {
      resumen.errores.push({ id: p.clave, motivo: e instanceof Error ? e.message : 'desconocido' });
    }
    detalle.push(resumen);
  }

  return { seco, proyectos: leidos, cambios, conflictos, avisos, escribio, detalle, ms: ahora() - arranque };
}
