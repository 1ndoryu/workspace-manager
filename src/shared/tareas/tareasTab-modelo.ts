/* Funciones puras de la tab kanban (partido de tareasTab.ts): guardas, normalizacion de respuestas,
 * lecturas honestas de `campos` y construccion de movimientos. Sin IO ni React: testeable a pelo. */
import type { ArbolTarea, ColumnaTab, ParcheTareaTab, TareaTab, TareasMovimientoTab } from './tareasTab-tipos.js';
import { FECHAS_TAREA, PRIORIDADES_TAREA, URGENCIAS_TAREA } from './tareasTab-tipos.js';

/* Normaliza la base que manda el puente ('' = sin-base, no vale como enlace). */
export function baseDeEstado(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function esTareaTab(v: unknown): v is TareaTab {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    Number.isInteger(t.legacyId) &&
    Number.isInteger(t.orden) &&
    typeof t.campos === 'object' &&
    t.campos !== null
  );
}

/* Normaliza un item del puente a TareaTab (null si no es item valido).
 * [por que] El proxy sirve {id, item:{orden, proyectoId, texto, ...}} y la
 * tab trabaja con {legacyId, orden, proyectoId, campos}: sin esta
 * normalizacion el filtro de esTareaTab descarta el 100% (bug 2026-10-07:
 * las columnas salian siempre vacias aunque el proxy trajera tareas). */
export function tareaDePuente(v: unknown): TareaTab | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  if (!Number.isInteger(p.id)) return null;
  if (typeof p.item !== 'object' || p.item === null) return null;
  const item = p.item as Record<string, unknown>;
  if (!Number.isInteger(item.orden)) return null;
  const t: TareaTab = {
    legacyId: p.id as number,
    orden: item.orden as number,
    campos: item as Record<string, unknown>,
  };
  if (Number.isInteger(item.proyectoId)) t.proyectoId = item.proyectoId as number;
  return t;
}

/* Respuesta validada: normaliza cada item del puente y descarta lo que no
 * sea tarea (igual que historialSitioVps descarta lo que no sea tupla). */
export function tareasDeRespuesta(datos: unknown): TareaTab[] {
  if (typeof datos !== 'object' || datos === null) return [];
  const lista = (datos as { tareas?: unknown }).tareas;
  if (!Array.isArray(lista)) return [];
  const normalizadas: TareaTab[] = [];
  for (const v of lista) {
    const t = tareaDePuente(v);
    if (t !== null) normalizadas.push(t);
  }
  return normalizadas;
}

/* El PUT F1 es upsert de reemplazo: sin proyectoId TASKS lo pone a null
 * y la tarjeta se vuelve huerfana invisible (bug 2026-10-07: completar
 * desde el menu "borraba" la tarjeta). El hook inyecta su columna con
 * esta pura para que el invariante quede cubierto por test. */
export function parcheConColumna(columna: number, parche: ParcheTareaTab): ParcheTareaTab {
  return {...parche, proyectoId: columna};
}

/* Lo que la respuesta dice de la escritura en el roadmap (20AA-10 F3b). El PUT/DELETE/reorden
 * tocan dos sitios —TASK y el `roadmap.md` del proyecto— y el segundo puede fallar despues de que
 * el primero haya funcionado: la tarjeta esta guardada y el archivo no. Eso no puede quedarse en
 * el cuerpo de la respuesta sin que nadie lo lea, asi que se convierte en una linea de aviso.
 * [por que se acepta objeto o lista] El reorden puede tocar dos columnas (arrastre entre
 * proyectos) y devuelve una por cada una. */
export function avisoDeRespuesta(datos: unknown): string | null {
  const roadmap = (datos as {roadmap?: unknown} | null)?.roadmap;
  const items = Array.isArray(roadmap) ? roadmap : roadmap === null || roadmap === undefined ? [] : [roadmap];
  const partes: string[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const {aviso, proyecto} = item as {aviso?: unknown; proyecto?: unknown};
    if (typeof aviso !== 'string' || aviso === '') continue;
    partes.push(typeof proyecto === 'string' && proyecto !== '' ? `${proyecto}: ${aviso}` : aviso);
  }
  return partes.length === 0 ? null : partes.join(' · ');
}

/* Lecturas honestas de los campos (campos es Record<string, unknown>):
 * lo ausente o roto cae al defecto, nunca rompe el render. */
export function completadoTarea(t: TareaTab): boolean {
  return t.campos.completado === true;
}

export function prioridadTarea(t: TareaTab): string | null {
  const v = t.campos.prioridad;
  return typeof v === 'string' && (PRIORIDADES_TAREA as readonly string[]).includes(v) ? v : null;
}

export function urgenciaTarea(t: TareaTab): string {
  const v = t.campos.urgencia;
  return typeof v === 'string' && (URGENCIAS_TAREA as readonly string[]).includes(v) ? v : 'normal';
}
export function textoTarea(t: TareaTab): string {
  for (const k of ['texto', 'titulo', 'nombre', 'name']) {
    const v = t.campos[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return `#${t.legacyId}`;
}

/* --- Subtareas y propiedades del roadmap (20AA-10 F4) ---------------------------------------
 * Lo que el tab necesita saber de una tarea para pintarla anidada y para editar lo que el roadmap
 * guarda en su linea «·». Todo son lecturas honestas de `campos` (lo ausente o roto no rompe el
 * render) y una escritura: la lista de etiquetas tecleada por la usuaria. */

/* El padre de una tarea, o null si es raiz. */
export function padreDeTarea(t: TareaTab): number | null {
  const v = t.campos.parentId;
  return Number.isInteger(v) ? (v as number) : null;
}

/* Es una subtarea de TASK (hija de otra tarjeta de la misma columna). */
export function esSubtarea(t: TareaTab): boolean {
  return padreDeTarea(t) !== null;
}

export function arbolDeTareas(lista: TareaTab[]): ArbolTarea[] {
  const ids = new Set(lista.map((t) => t.legacyId));
  /* [por que] Una subtarea cuyo padre no esta en la lista se pinta como raiz: huerfana visible
   * antes que desaparecida (el padre puede no haber llegado en la foto local). */
  const raices = lista.filter((t) => {
    const p = padreDeTarea(t);
    return p === null || !ids.has(p);
  });
  return raices.map((raiz) => ({ raiz, hijas: lista.filter((t) => padreDeTarea(t) === raiz.legacyId) }));
}

function textos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

export function etiquetasTarea(t: TareaTab): string[] {
  return textos(t.campos.etiquetas);
}

export function dependeDeTarea(t: TareaTab): string[] {
  return textos(t.campos.dependeDe);
}

/* Solo las fechas que la tarea dice, por su nombre del roadmap. */
export function fechasTarea(t: TareaTab): Record<string, string> {
  const f: Record<string, string> = {};
  for (const k of FECHAS_TAREA) {
    const v = t.campos[k];
    if (typeof v === 'string' && v.trim() !== '') f[k] = v.trim();
  }
  return f;
}

/* Una fecha en la forma que el roadmap lee (`RE_FECHA`), o null si no lo es: el campo de fecha
 * vacio llega como '' y no puede viajar como si fuera una fecha. */
export function fechaValida(v: string): string | null {
  const limpio = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(limpio) ? limpio : null;
}

/* Lo que la usuaria tecleo en un campo de lista, en lista. [por que se corta por coma y no por
 * espacio] Una etiqueta puede llevar espacios («vps 89») y el campo es una sola linea: la coma es
 * el unico separador que no aparece dentro de un nombre. */
export function listaTecleada(texto: string): string[] {
  return texto
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/* Una lista tecleada como campo de texto: lo que se pinta en el formulario. */
export function listaATexto(lista: string[]): string {
  return lista.join(', ');
}

/* Orden nuevo de una columna como movimientos bulk (orden = posicion). */
export function construirMovimientos(
  ordenados: { legacyId: number }[],
  proyectoId: number,
): TareasMovimientoTab[] {
  return ordenados.map((t, i) => ({ legacyId: t.legacyId, orden: i, proyectoId }));
}

export function esColumnaTab(v: unknown): v is ColumnaTab {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.clave === 'string' &&
    c.clave !== '' &&
    typeof c.nombre === 'string' &&
    c.nombre !== '' &&
    Number.isInteger(c.legacyId) &&
    (c.legacyId as number) > 0
  );
}

export function columnasDeRespuesta(datos: unknown): ColumnaTab[] {
  if (typeof datos !== 'object' || datos === null) return [];
  const lista = (datos as { proyectos?: unknown }).proyectos;
  if (!Array.isArray(lista)) return [];
  const columnas: ColumnaTab[] = [];
  const vistas = new Set<string>();
  for (const v of lista) {
    if (!esColumnaTab(v) || vistas.has(v.clave)) continue;
    vistas.add(v.clave);
    columnas.push({ clave: v.clave, nombre: v.nombre, legacyId: v.legacyId });
  }
  return columnas;
}
