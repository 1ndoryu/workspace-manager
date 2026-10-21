/* Fuente «tareas» de la campana (20AA-25 N1): el trabajo abierto del roadmap de cada proyecto.
 * [por que del roadmap y no de TASK] La usuaria lo dejó escrito: «se dejó de detectar una tarea
 * (se borró o se marcó como completada, da igual) = se completó». El roadmap es la fuente de
 * verdad de lo pendiente —al cerrar una tarea, su línea sale del archivo (D8)— y ya viene en el
 * snapshot que el tablero pide igualmente, así que la campana no añade ni una lectura ni una
 * conexión. TASK sería una segunda verdad que, además, se sincroniza HACIA el roadmap: esperar a
 * que se propague sólo añadiría retraso y avisos repetidos.
 * Clave: `proyecto|ID`. El ID del protocolo es estable y global dentro del proyecto, que es
 * exactamente lo que hace falta para no confundir una tarea con otra al reordenar. */
import type { Proyecto } from '../../../shared/tipos/proyecto.js';
import type { Entidad, Fuente } from '../../../shared/notificaciones/tipos.js';

/* Tope de entidades por pasada. [por que] Un roadmap fuera de protocolo no puede inflar el JSON
 * del almacén ni el diff; por encima de esto lo que hay es un problema del proyecto, no avisos. */
export const TOPE_TAREAS = 2000;

/* El título que se enseña de una tarea del roadmap: `ID — título`, recortado. Sin ID no hay
 * tarea (el protocolo lo exige), así que un pendiente sin ID no entra: no se podría seguir. */
export function entidadesDeTareas(proyectos: Proyecto[]): Entidad[] {
  const salida: Entidad[] = [];
  for (const p of proyectos) {
    for (const t of p.roadmap?.tareas ?? []) {
      const id = t.id.trim();
      if (id === '') continue;
      const titulo = t.titulo.trim();
      salida.push({
        clave: `${p.clave}|${id}`,
        titulo: titulo === '' ? id : `«${recortar(titulo, 90)}»`,
        detalle: `${p.id} · ${id}`,
      });
      if (salida.length >= TOPE_TAREAS) return salida;
    }
  }
  return salida;
}

/* [por que recortar aquí] El almacén guarda el texto de cada entidad; un roadmap con una línea de
 * 4 000 caracteres no debe engordar el fichero ni la campana. */
function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

/* La fuente. `leerProyectos` la inyecta quien ya tiene el snapshot (index.ts): así lee la memoria
 * del servidor y no vuelve a recorrer el disco. */
export function fuenteTareas(leerProyectos: () => Proyecto[] | Promise<Proyecto[]>): Fuente {
  return {
    nombre: 'tareas',
    tipoAlta: 'tarea-nueva',
    tipoBaja: 'tarea-completada',
    async leer() {
      try {
        const proyectos = await leerProyectos();
        return { entidades: entidadesDeTareas(proyectos), problema: null };
      } catch (err) {
        /* Sin lectura no se puede decir que nada desapareció: se declara rota (el motor no toca su
         * memoria) y se sigue con las demás fuentes. */
        return { entidades: [], problema: `no se pudo leer el roadmap: ${mensaje(err)}` };
      }
    },
  };
}

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
