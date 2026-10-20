/* Tipos y constantes del analisis del roadmap (D8): sin logica ni E/S. Los usan la lectura de
 * lineas (analisis-lectura.ts) y el analisis (roadmapAnalisis.ts), que los reexporta. */
/** Secciones fijas del roadmap (D8), en orden. */
export const SECCIONES_ROADMAP = ['Siguiente bloque', 'Pendientes', 'Bloqueos', 'Planes activos'];

/** Tope de lineas: pasarlo significa tener demasiado abierto (D8). */
export const TOPE_LINEAS_ROADMAP = 400;

/** Tope de IDs/tareas que viajan al tablero. [por que] Acotar la salida (AGENTS §5):
 * un roadmap desbordado no debe engordar el snapshot sin limite.
 * [por que 60 y no 40] Recorta la lista de tareas, no solo los IDs (`resumenRoadmap`), y lo hacia
 * en silencio: con 41 pendientes el tablero veia 40 y la tarea 41 no llegaba ni a la consola ni a
 * TASK. proyecto-h ya tiene 36 y el tope de lineas (400) sigue siendo el limite de verdad; el
 * recorte, cuando ocurre, ahora se dice (comprobacion `roadmap-protocolo`). */
export const TOPE_TAREAS = 60;

/* Claves de la linea de propiedades, en el orden en que se escriben. */
export const CLAVES_PROPIEDAD = ['prioridad', 'urgencia', 'creada', 'pospuesta', 'completada', 'etiquetas', 'depende-de'] as const;
export type ClavePropiedad = (typeof CLAVES_PROPIEDAD)[number];

/** Propiedades que el tab escribe bajo una tarea. Lo ausente es el valor por defecto. */
export interface PropiedadesTarea {
  prioridad?: string;
  urgencia?: string;
  creada?: string;
  pospuesta?: string;
  completada?: string;
  etiquetas?: string[];
  dependeDe?: string[];
}

/** Subtarea de una tarea del roadmap (sangrada bajo ella; no lleva ID). */
export interface SubtareaRoadmap {
  titulo: string;
  completada: boolean;
  linea: number;
  propiedades: PropiedadesTarea;
}

/* IDs usados en el area: {DD}{M}{A}-{N} (297A-4, 19AA-4), H-<dominio>-<n>-<m> (H-F12-14),
 * fases cortas (F0, T7, S17, R2, A3d) y los esquemas propios de cada proyecto, que D8 permite
 * (OP-49c en opencode-propio, A3b-verif en varsense).
 * [por que] RE_ID no valida el ID de una tarea —eso lo da la forma canonica, con el ID entre
 * comillas invertidas— sino que reconoce «aqui hay un ID» para las lineas mal escritas (heading,
 * bullet sin casilla, tabla). Con el patron viejo un proyecto con esquema propio no veia
 * detectadas sus tareas mal escritas: medido el 2026-10-20, 42 IDs reales del area se le escapaban
 * (33 OP-nn de opencode-propio y 9 numeros sueltos de proyecto-h).
 * Los numeros sueltos NO se admiten a proposito: un `1` es indistinguible de cualquier cifra en
 * prosa y convertiria en «tarea en tabla» o «tarea sin casilla» media docena de lineas legitimas. */
const RE_ID = /\b(?:\d{2,3}[A-C][A-Z]?-\d+|[A-Z]-[A-Z]+\d+-\d+|[A-Z]{1,4}-?\d+[a-z]?(?:-[A-Za-z0-9]+)?)\b/;

/* Tarea canonica: casilla sin marcar, ID entre comillas invertidas y titulo. */
const RE_TAREA = /^[-*] \[ \] `([^`]+)`\s*(?:—|–|-|:)?\s*(.*)$/;
const RE_CASILLA = /^[-*] \[([ xX])\]\s*(.*)$/;
/* Item al primer nivel (bullet o numerado) con ID al principio, en negrita o en comillas
 * invertidas: la forma vieja de escribir una tarea sin casilla. */
const RE_ITEM_ID = /^(?:[-*]|\d+\.)\s+(?:`([^`]+)`|\*\*([^*]+)\*\*)/;
/* Ruta de un plan dentro del roadmap (D8: seccion «Planes activos»). */
const RE_PLAN = /Agente\/planes\/([^\s`)]+\.md)/;
/* Nombres de seccion que son zona de tareas aunque no sean los canonicos. */
const RE_ZONA_TAREAS = /pendiente|backlog|tarea|por hacer|cola|desarrollo pendiente/;

/* Linea de propiedades: empieza por «·» y sigue con pares «clave: valor» separados por « · ». */
const RE_PROPIEDADES = /^\s*·\s*(.+)$/;
/* Subtarea: casilla sangrada con titulo en negrita (sin negrita es cuerpo en prosa). */
const RE_SUBTAREA = /^(\s+)[-*] \[([ xX])\] \*\*(.+?)\*\*\s*$/;
/* Fecha en forma ISO corta: es la que escribe el tab. */
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
/* El nombre de la tarea: la negrita que abre la linea, si la lleva. */
const RE_NOMBRE = /^\*\*(.+?)\*\*/;

/* Titulo de una tarea: su nombre en negrita, o la linea entera si no la lleva.
 * [por que no la linea entera] El nombre es el titulo; lo que va detras y las lineas sangradas
 * son el cuerpo en prosa de la tarea. Leer la linea entera mandaba a TASK un texto cortado a
 * media frase (medido 2026-10-20: en el area, 195 de 209 tareas tienen cola, y el corte caia en
 * mitad de una palabra), y hacia que la misma tarea se llamara de una forma en el roadmap y de
 * otra en el tab. Sin negrita no hay nombre que reconocer y se toma la linea tal cual. */
function nombreDeTitulo(resto: string): string {
  const m = resto.match(RE_NOMBRE);
  return (m === null ? resto : m[1]).trim();
}

export interface TareaRoadmap {
  id: string;
  titulo: string;
  linea: number;
  /* Propiedades de la linea «·», si la hay. */
  propiedades: PropiedadesTarea;
  /* Subtareas sangradas bajo esta tarea, en orden. */
  subtareas: SubtareaRoadmap[];
}

/** Linea con pinta de tarea que no cumple la forma del protocolo. */
export interface ProblemaRoadmap {
  linea: number;
  texto: string;
  motivo: string;
}

export interface AnalisisRoadmap {
  tareas: TareaRoadmap[];
  problemas: ProblemaRoadmap[];
  lineas: number;
  /* Secciones canonicas ausentes. */
  faltantes: string[];
  /* Headings que no son una seccion canonica (p. ej. «## Hecho»). */
  noCanonicas: string[];
  /* Planes que el roadmap declara activos. */
  planes: string[];
  /* IDs del documento entero (contexto incluido), como antes. */
  ids: string[];
}
