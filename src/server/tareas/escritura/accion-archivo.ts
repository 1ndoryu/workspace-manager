/* Operaciones sobre las lineas del roadmap para las acciones del tab (20AA-10 F3b): crear, cerrar,
 * borrar y reordenar. Todo puro —entra texto, sale texto— para poder probarlo sin disco ni red.
 * [por que el bloque y no la linea] Una tarea del roadmap no es una linea: es su linea, su linea de
 * propiedades, sus subtareas y su cuerpo en prosa. Mover o quitar la linea suelta dejaria huerfanos
 * los demas, y el protocolo (D8) se rompe con una linea `·` colgando.
 * [por que lo que no es una tarea se queda donde esta] La prosa de una seccion es de quien la
 * escribio: reordenar mueve bloques de tarea entre sus huecos, nunca la prosa de en medio. */
import type { PropiedadesTarea, TareaRoadmap } from '../../scanner/roadmap/roadmap.js';
import { lineaPropiedades } from './plan-archivo.js';
import { contenidoDe } from './contenido-tarea.js';

/* Tarea de primer nivel (con o sin ID): es lo que cierra el bloque de la anterior. */
const RE_TAREA_NIVEL = /^[-*] \[[ xX]\] /;
const RE_ENCABEZADO = /^#{1,6} /;
const RE_ENCABEZADO_SECCION = /^## /;

export interface Bloque {
  /* Indices 0-based, `hasta` excluido y sin las lineas en blanco del final. */
  desde: number;
  hasta: number;
}

/* Las lineas que son de una tarea: desde la suya hasta la siguiente tarea de primer nivel, el
 * siguiente encabezado, el final del archivo o una linea en blanco. [por que la linea en blanco
 * cierra el bloque] El titulo puede seguir en varias lineas indentadas y la de propiedades va
 * pegada, pero lo que viene tras un hueco es prosa de la seccion, no de la tarea: borrarla o
 * moverla con ella seria llevarse texto de quien lo escribio. */
export function bloqueDeTarea(lineas: string[], t: TareaRoadmap): Bloque {
  const desde = Math.max(0, t.linea - 1);
  let hasta = desde + 1;
  while (hasta < lineas.length) {
    const l = lineas[hasta] ?? '';
    if (l.trim() === '' || RE_TAREA_NIVEL.test(l) || RE_ENCABEZADO.test(l)) break;
    hasta += 1;
  }
  return { desde, hasta };
}

/* Nombre de la seccion en la que vive una linea: el `##` mas cercano por encima. */
export function seccionDe(lineas: string[], linea: number): string | null {
  for (let i = Math.min(linea - 1, lineas.length - 1); i >= 0; i -= 1) {
    const m = (lineas[i] ?? '').match(RE_ENCABEZADO_SECCION);
    if (m !== null) return (lineas[i] ?? '').slice(3).trim();
  }
  return null;
}

/* Quita la tarea entera. Se lleva una de las dos lineas en blanco de la union si quedarian
 * pegadas, para no dejar un hueco doble donde estaba. */
export function quitarTarea(lineas: string[], t: TareaRoadmap): string[] {
  const { desde, hasta } = bloqueDeTarea(lineas, t);
  const fuera = [...lineas.slice(0, desde), ...lineas.slice(hasta)];
  if ((fuera[desde - 1] ?? '').trim() === '' && (fuera[desde] ?? '').trim() === '') fuera.splice(desde, 1);
  return fuera;
}

/* ID nuevo para una tarea creada desde el tab: `{DD}AA-{N}`, con N el siguiente libre. [por que AA]
 * Es el sufijo que llevan todos los IDs del area (`17AA-2`, `19AA-1`, `20AA-10`); el ID solo es unico
 * dentro del proyecto, asi que dos proyectos pueden tener el mismo `20AA-3` sin chocar. */
export function siguienteId(usados: Iterable<string>, ahora: Date): string {
  const prefijo = `${String(ahora.getDate()).padStart(2, '0')}AA`;
  const tomados = new Set(usados);
  for (let n = 1; ; n += 1) {
    const id = `${prefijo}-${n}`;
    if (!tomados.has(id)) return id;
  }
}

/* El titulo del protocolo acaba en punto, y ese punto es formato, no texto: el parser no lo quita
 * (el titulo leido de un roadmap lo trae), asi que al escribir se quita el que venga y se pone uno.
 * Sin esto, cerrar una tarea deja `Comprar pan..` o `Comprar pan**` segun de donde venga el texto. */
export function tituloCanonico(texto: string): string {
  return texto.trim().replace(/\.+$/, '').trim();
}

/* La linea de una tarea nueva, con su linea de propiedades si hay algo que decir. El texto que
 * viaja a TASK es este mismo titulo con el punto, para que el ida y vuelta de las dos lecturas de
 * lo mismo. */
export function lineasDeTarea(id: string, texto: string, p: PropiedadesTarea): string[] {
  const props = lineaPropiedades(contenidoDe(p, texto));
  const titulo = `- [ ] \`${id}\` — **${tituloCanonico(texto)}.**`;
  return props === null ? [titulo] : [titulo, props];
}

export interface TareaNueva {
  id: string;
  texto: string;
  propiedades: PropiedadesTarea;
  seccion: string;
}

/* Añade una tarea al final de su seccion. Devuelve las lineas nuevas y en cual quedo la tarea (para
 * el historial y para el `sitio`). Null si esa seccion no existe: crear la seccion seria inventarse
 * la estructura del roadmap de otro, y eso no lo hace el puente. */
export function insertarTarea(
  lineas: string[],
  nueva: TareaNueva,
): { lineas: string[]; linea: number } | null {
  const cabecera = lineas.findIndex((l) => RE_ENCABEZADO_SECCION.test(l) && l.slice(3).trim() === nueva.seccion);
  if (cabecera < 0) return null;
  let fin = cabecera + 1;
  while (fin < lineas.length && !RE_ENCABEZADO_SECCION.test(lineas[fin] ?? '')) fin += 1;
  /* El final de la seccion: tras la ultima linea con algo. Las lineas en blanco de despues se
   * quedan como separacion. */
  let hueco = fin;
  while (hueco > cabecera + 1 && (lineas[hueco - 1] ?? '').trim() === '') hueco -= 1;
  const bloque = lineasDeTarea(nueva.id, nueva.texto, nueva.propiedades);
  const antes = hueco > cabecera + 1 ? [''] : [];
  const salida = [...lineas.slice(0, hueco), ...antes, ...bloque, ...lineas.slice(hueco)];
  return { lineas: salida, linea: hueco + antes.length + 1 };
}

/* Reordena los bloques de las tareas mencionadas dentro de su seccion. Las tareas que no vienen en
 * `idsEnOrden` se quedan en su hueco: el tab manda el orden de su columna, y una tarea que exista en
 * el archivo y no en la columna no tiene por que moverse por eso. */
export function reordenarTareas(lineas: string[], tareas: TareaRoadmap[], idsEnOrden: string[]): string[] {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const pedido = idsEnOrden.filter((id) => porId.has(id));
  if (pedido.length < 2) return lineas;

  /* Se agrupa por seccion: el orden del tab es el de una columna, y una columna puede tener sus
   * tareas repartidas en `## Siguiente bloque` y `## Pendientes`. */
  const secciones = new Map<string, TareaRoadmap[]>();
  for (const t of tareas) {
    const s = seccionDe(lineas, t.linea);
    if (s === null) continue;
    secciones.set(s, [...(secciones.get(s) ?? []), t]);
  }

  const salida = [...lineas];
  for (const deSeccion of secciones.values()) {
    const mencionadas = deSeccion.filter((t) => pedido.includes(t.id));
    if (mencionadas.length < 2) continue;
    /* Los huecos son las tareas mencionadas, en el orden del documento; cada hueco recibe la tarea
     * que el tab pone en esa posicion. Las no mencionadas no entran: el tab manda su columna, y lo
     * que exista en el archivo y no en la columna no tiene por que moverse por eso. */
    const orden = pedido.filter((id) => mencionadas.some((t) => t.id === id));
    const cambios: { desde: number; hasta: number; contenido: string[] }[] = [];
    mencionadas.forEach((t, i) => {
      const origen = porId.get(orden[i] ?? '');
      if (origen === undefined) return;
      const hueco = bloqueDeTarea(lineas, t);
      const suyo = bloqueDeTarea(lineas, origen);
      cambios.push({ ...hueco, contenido: lineas.slice(suyo.desde, suyo.hasta) });
    });
    /* De abajo arriba: los indices de los bloques que quedan por sustituir no se mueven. */
    for (const c of cambios.sort((a, b) => b.desde - a.desde)) {
      salida.splice(c.desde, c.hasta - c.desde, ...c.contenido);
    }
  }
  return salida;
}

/* La entrada del registro de completados del proyecto (D8: al cerrar, la tarea sale del roadmap y
 * queda aqui). */
export function entradaCompletado(id: string, texto: string, ahora: Date): string {
  return `- **${id} · ${tituloCanonico(texto)}.** Cerrada desde el tab (TASK), ${ahora.toISOString().slice(0, 10)}.`;
}

/* Indice de la entrada de esa tarea en el registro de completados, o null. [por que] Al reabrir
 * hay que quitarla: si se queda, el registro afirma cerrada una tarea que el roadmap da por
 * pendiente, y dos fuentes dicen cosas distintas. Se empareja por el ID y no por el texto, que
 * puede haberse editado desde entonces. */
export function indiceCompletado(lineas: string[], id: string): number | null {
  const i = lineas.findIndex((l) => l.startsWith(`- **${id} · `));
  return i < 0 ? null : i;
}
