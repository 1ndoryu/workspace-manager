/* Resumen del roadmap de un proyecto con E/S (lectura de roadmap.md). Separado del analisis
 * puro (roadmapAnalisis.ts) para que el parseo se pueda probar sin tocar el disco. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analizarRoadmap, TOPE_TAREAS } from './roadmapAnalisis.js';
import { planesEnDisco } from './planesDisco.js';
import type { ResumenRoadmap } from '../../../shared/types.js';

const VACIO: ResumenRoadmap = {
  pendientes: 0,
  activos: 0,
  ids: [],
  tareas: [],
  resumen: '',
  lineas: 0,
  problemas: 0,
  faltantes: [],
  planes: [],
};

/** Extrae el resumen compacto del roadmap.md de un proyecto. */
export function resumenRoadmap(ruta: string): ResumenRoadmap {
  const archivo = join(ruta, 'roadmap.md');
  if (!existsSync(archivo)) return VACIO;
  try {
    const a = analizarRoadmap(readFileSync(archivo, 'utf8'));
    return {
      pendientes: a.tareas.length,
      /* [por que del disco y no de `a.planes`] La usuaria, 2026-10-23: un plan está vivo porque
       * su fichero sigue en `Agente/planes/`, no porque el roadmap lo liste. El MD solo describe:
       * leer el contador de ahí hacía invisible un plan entero en cuanto su línea desaparecía. */
      activos: planesEnDisco(ruta, a.planes).length,
      ids: a.ids,
      /* ID y titulo de cada tarea: la consola de problemas las lista y las filtra. */
      tareas: a.tareas.slice(0, TOPE_TAREAS).map((t) => ({ id: t.id, titulo: t.titulo })),
      resumen: a.tareas
        .slice(0, 8)
        .map((t) => t.titulo)
        .join(' · '),
      lineas: a.lineas,
      problemas: a.problemas.length,
      faltantes: a.faltantes,
      planes: a.planes,
    };
  } catch {
    return VACIO;
  }
}
