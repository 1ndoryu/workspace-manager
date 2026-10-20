/* Acciones sobre subtareas del tab (20AA-10 F4): alta, edicion y borrado dentro del bloque de su padre.
 * Se apoyan en accion-base para abrir y escribir, igual que las de tareas. */
import { type SubtareaRoadmap, type TareaRoadmap } from '../../scanner/roadmap/roadmap.js';
import { contenidoDe, textoDeTitulo } from './contenido-tarea.js';
import { diferencias, type CambioArchivo } from './plan-archivo.js';
import {
  buscarSubtarea,
  huecoDeSubtarea,
  insertarSubtarea,
  quitarSubtarea,
  reescribirSubtarea,
  type SubtareaNueva,
} from './accion-archivo.js';
import {
  abrir,
  escribir,
  sinEfecto,
  type AccionTab,
  type Contexto,
  type DepsAccionRoadmap,
  type ProyectoRoadmap,
  type ResultadoAccion,
} from './accion-base.js';

/* Como se refiere el espejo a una subtarea: por su texto (el emparejado bueno) y por su hueco
 * entre las hermanas (el de respaldo, cuando el texto cambio desde la ultima vez). */
export interface RefSubtarea {
  texto: string;
  hueco: number | null;
}

/* --- Subtareas (F4) -------------------------------------------------------------------------
 * Una subtarea no tiene ID en el archivo: se identifica por su texto entre las hermanas y, si el
 * texto cambio, por su hueco. Es el mismo emparejado que hace la otra direccion (`planSubtareas`),
 * y tiene que serlo: si cada lado eligiera distinto, uno reescribiria lo que el otro dejo. */

/* La etiqueta con la que el espejo nombra una subtarea, igual que en la otra direccion. */
function etiqueta(idPadre: string, hueco: number): string {
  return `${idPadre}#${hueco + 1}`;
}

/* El hueco que codifica una etiqueta `padre#n`. [por que] Quien acaba de escribir la subtarea no
 * sabe en que hueco quedo hasta que la busca; la etiqueta que devuelve la accion lo dice, y este es
 * el unico sitio donde se lee. */
export function huecoDeEtiqueta(id: string): number | null {
  const m = id.match(/#(\d+)$/u);
  return m === null ? null : Number(m[1]) - 1;
}

type AbiertoPadre = { ok: true; ctx: Contexto; padre: TareaRoadmap } | { ok: false; resultado: ResultadoAccion };

/* Abre el roadmap y resuelve la tarea padre. Un solo sitio para el «no esta» de las tres acciones. */
function abrirPadre(deps: DepsAccionRoadmap, p: ProyectoRoadmap, accion: AccionTab, idPadre: string): AbiertoPadre {
  const a = abrir(deps, p, accion);
  if (!a.ok) return a;
  const padre = a.ctx.lectura.tareas.find((x) => x.id === idPadre);
  if (padre === undefined) return { ok: false, resultado: sinEfecto(accion, p, 'no-esta-en-el-roadmap', idPadre) };
  return { ok: true, ctx: a.ctx, padre };
}

/* Alta: la subtarea va al final del bloque de su padre. */
export function crearSubtarea(
  deps: DepsAccionRoadmap,
  p: ProyectoRoadmap,
  idPadre: string,
  nueva: SubtareaNueva,
): ResultadoAccion {
  const a = abrirPadre(deps, p, 'crear-sub', idPadre);
  if (!a.ok) return a.resultado;
  const { ctx, padre } = a;
  const puesto = insertarSubtarea(ctx.lineas, padre, nueva);
  const hueco = padre.subtareas.length;
  const etiquetaSub = etiqueta(idPadre, hueco);
  const cambios: CambioArchivo[] = [{ id: etiquetaSub, campo: 'subtarea-crear', antes: null, despues: nueva.texto }];
  return escribir(ctx, p, 'crear-sub', puesto.lineas, cambios, etiquetaSub, () => puesto.linea);
}

/* Edicion: el texto, sus propiedades y su casilla. La linea del padre no se toca. */
export function editarSubtarea(
  deps: DepsAccionRoadmap,
  p: ProyectoRoadmap,
  idPadre: string,
  ref: RefSubtarea,
  nueva: SubtareaNueva,
): ResultadoAccion {
  const a = abrirPadre(deps, p, 'editar-sub', idPadre);
  if (!a.ok) return a.resultado;
  const { ctx, padre } = a;
  const s = buscarSubtarea(padre, ref);
  if (s === null) return sinEfecto('editar-sub', p, 'no-esta-la-subtarea', idPadre);
  const hueco = huecoDeSubtarea(padre, s);
  const etiquetaSub = etiqueta(idPadre, hueco < 0 ? 0 : hueco);
  const cambios = cambiosDeSubtarea(etiquetaSub, s, nueva);
  if (cambios.length === 0) return sinEfecto('editar-sub', p, 'sin-cambios', etiquetaSub);
  const lineas = reescribirSubtarea(ctx.lineas, s, nueva);
  return escribir(ctx, p, 'editar-sub', lineas, cambios, etiquetaSub, () => s.linea);
}

/* Borrado: se va la subtarea, con su linea de propiedades si la lleva. */
export function borrarSubtarea(
  deps: DepsAccionRoadmap,
  p: ProyectoRoadmap,
  idPadre: string,
  ref: RefSubtarea,
): ResultadoAccion {
  const a = abrirPadre(deps, p, 'borrar-sub', idPadre);
  if (!a.ok) return a.resultado;
  const { ctx, padre } = a;
  const s = buscarSubtarea(padre, ref);
  if (s === null) return sinEfecto('borrar-sub', p, 'no-esta-la-subtarea', idPadre);
  const hueco = huecoDeSubtarea(padre, s);
  const etiquetaSub = etiqueta(idPadre, hueco < 0 ? 0 : hueco);
  const cambios: CambioArchivo[] = [{ id: etiquetaSub, campo: 'subtarea-borrar', antes: s.titulo, despues: null }];
  return escribir(ctx, p, 'borrar-sub', quitarSubtarea(ctx.lineas, s), cambios, etiquetaSub);
}

/* Lo que cambio en una subtarea, campo a campo. El estado de la casilla va aparte: no es una
 * propiedad de la linea «·», es la casilla, y el historial tiene que decir cual de las dos. */
function cambiosDeSubtarea(etiquetaSub: string, s: SubtareaRoadmap, nueva: SubtareaNueva): CambioArchivo[] {
  const cambios = diferencias(
    contenidoDe(s.propiedades, textoDeTitulo(s.titulo)),
    contenidoDe(nueva.propiedades, nueva.texto),
    etiquetaSub,
  );
  const ahora = nueva.completada === true;
  if (s.completada !== ahora) {
    cambios.push({ id: etiquetaSub, campo: 'completada', antes: String(s.completada), despues: String(ahora) });
  }
  return cambios;
}
