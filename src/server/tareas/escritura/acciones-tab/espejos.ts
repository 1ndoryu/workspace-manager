/* Espejos del roadmap que se releen tras una escritura (E/S: disco y reloj). Viven aparte de
 * acciones-tab.ts para que el tab quede en menos de 300 lineas; el mapeo puro esta en mapeo.ts.
 * [por que aparte] Son los unicos que leen el archivo justo despues de escribirlo, asi que la
 * huella sale de la linea tal como quedo, no de la que se creyo escribir. */
import type { EspejoRoadmap } from '../../espejo-roadmap.js';
import { contenidoDe, huellaDeTarea, huellaDeTexto, textoDeTitulo } from '../contenido-tarea.js';
import { leerDelDisco, type LecturaRoadmap } from '../escribir-roadmaps.js';
import { SECCION_NUEVAS, type ProyectoRoadmap } from '../accion-roadmap.js';
import type { DepsAccionesTab } from './mapeo.js';

function leer(deps: DepsAccionesTab, ruta: string): LecturaRoadmap | null {
  return (deps.leerRoadmap ?? leerDelDisco)(ruta);
}

/* El espejo de una tarea que acaba de nacer en el archivo. [por que se relee el archivo] La huella
 * tiene que ser la de la linea tal como quedo escrita, no la que creiamos escribir: si el texto
 * llevaba punto o el titulo se recorto, la huella de la tarea y la de TASK tienen que coincidir o
 * la pasada siguiente la reescribiria otra vez. */
export function espejoDeAlta(deps: DepsAccionesTab, p: ProyectoRoadmap, id: string): EspejoRoadmap | null {
  const lectura = leer(deps, p.ruta);
  if (lectura === null) return null;
  const t = lectura.tareas.find((x) => x.id === id);
  if (t === undefined) return null;
  return {
    id,
    proyecto: p.clave,
    archivo: 'roadmap.md',
    seccion: SECCION_NUEVAS,
    huella: huellaDeTarea(t),
    escritoEn: new Date((deps.ahora ?? Date.now)()).toISOString(),
    mtimeArchivo: lectura.mtimeMs === null ? null : new Date(lectura.mtimeMs).toISOString(),
    espejo: contenidoDe(t.propiedades, textoDeTitulo(t.titulo)),
  };
}

/* El espejo de una subtarea que acaba de escribirse, releido del archivo. [por que se relee] La
 * huella tiene que ser la de la linea tal como quedo: si el titulo llevaba punto o el texto se
 * recorto, la huella de la linea y la de TASK tienen que coincidir o la pasada siguiente
 * reescribiria lo que esta bien. */
export function espejoDeSubtarea(
  deps: DepsAccionesTab,
  p: ProyectoRoadmap,
  idPadre: string,
  hueco: number | null,
): EspejoRoadmap | null {
  const lectura = leer(deps, p.ruta);
  const padre = lectura?.tareas.find((x) => x.id === idPadre);
  if (lectura === null || padre === undefined) return null;
  const s = hueco !== null && hueco >= 0 && hueco < padre.subtareas.length ? padre.subtareas[hueco] : padre.subtareas.at(-1);
  if (s === undefined) return null;
  const texto = textoDeTitulo(s.titulo);
  return {
    id: idPadre,
    proyecto: p.clave,
    archivo: 'roadmap.md',
    seccion: SECCION_NUEVAS,
    huella: huellaDeTexto(texto, s.propiedades),
    escritoEn: new Date((deps.ahora ?? Date.now)()).toISOString(),
    mtimeArchivo: lectura.mtimeMs === null ? null : new Date(lectura.mtimeMs).toISOString(),
    espejo: contenidoDe(s.propiedades, texto),
    sub: true,
    padre: idPadre,
    hueco: padre.subtareas.findIndex((x) => x.linea === s.linea),
  };
}
