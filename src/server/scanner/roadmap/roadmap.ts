/* Analisis del roadmap.md segun el protocolo (D8 de AGENTS-detalle.md).
 * [por que] El roadmap es la fuente de trabajo abierto del area, pero hasta 2026-10-19 cada
 * proyecto lo escribia a su manera (casillas sueltas, negritas, tablas, headings) y el tablero
 * solo contaba casillas: no podia decir si habia trabajo pendiente ni avisar de que el formato
 * se salia del protocolo. Forma canonica de una tarea, al primer nivel:
 *   - [ ] `ID` — **Titulo.**
 * [gotcha] El analisis es estricto a proposito: lo que no tenga esa forma NO cuenta como tarea
 * (sale como problema de formato) en vez de adivinarse. Las lineas sangradas son sub-pasos de
 * la tarea, igual que los bloques de codigo.
 * [por que 20AA-10] El tab y el roadmap son la misma lista de trabajo, asi que el tab escribe en
 * el archivo las propiedades de la tarea (prioridad, urgencia, fechas, etiquetas, dependencias)
 * y sus subtareas. Forma (plan-sincronia-tareas-roadmap-2026-10-20):
 *   - [ ] `ID` — **Titulo.**
 *     · prioridad: alta · urgencia: urgente · depende-de: 20AA-8
 *     - [ ] **Subtarea.**          (sangrada dos espacios mas que la tarea)
 *   Lo ausente son los valores por defecto y NO es un problema: asi el archivo no engorda. Lo que
 *   si esta escrito y no cuadra (clave desconocida, valor fuera del conjunto, par a medias,
 *   linea «·» fuera de sitio) es un problema de formato, como los de arriba. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRIORIDADES_TAREA, URGENCIAS_TAREA } from '../../../shared/tareas/tareasTab.js';
import type { ResumenRoadmap } from '../../../shared/types.js';

/** Secciones fijas del roadmap (D8), en orden. */
export const SECCIONES_ROADMAP = ['Siguiente bloque', 'Pendientes', 'Bloqueos', 'Planes activos'];

/** Tope de lineas: pasarlo significa tener demasiado abierto (D8). */
export const TOPE_LINEAS_ROADMAP = 400;

/** Tope de IDs/tareas que viajan al tablero. [por que] Acotar la salida (AGENTS §5):
 * un roadmap desbordado no debe engordar el snapshot sin limite.
 * [por que 60 y no 40] Recorta la lista de tareas, no solo los IDs (`resumenRoadmap`), y lo hacia
 * en silencio: con 41 pendientes el tablero veia 40 y la tarea 41 no llegaba ni a la consola ni a
 * TASK. RESTAURANTE ya tiene 36 y el tope de lineas (400) sigue siendo el limite de verdad; el
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
 * (33 OP-nn de opencode-propio y 9 numeros sueltos de RESTAURANTE).
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

/* Espacios de sangria al principio de una linea. */
function sangria(linea: string): number {
  return linea.match(/^\s*/)?.[0].length ?? 0;
}

/* Normaliza un titulo de seccion: sin numeracion, sin signos ni emoji, en minusculas y con
 * espacios simples. [por que] Los headings reales llevan adornos («## 6. Desarrollo pendiente»,
 * «## 🔴 Pendiente crítico», «## Pendientes (orden de dependencia)»). */
function normalizar(texto: string): string {
  return texto
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* Seccion canonica a la que corresponde un titulo, o null si no es ninguna. Casa por prefijo
 * para admitir el singular y el plural («Pendiente»/«Pendientes») y los adornos. */
function seccionCanonica(titulo: string): string | null {
  const n = normalizar(titulo);
  /* El contexto (D8) admite las dos formas: párrafo «**Contexto.**» al principio o sección
   * propia. No se exige, por eso no está en SECCIONES_ROADMAP. */
  if (/^contexto\b/.test(n)) return 'Contexto';
  if (/^(siguiente bloque|bloque actual|ahora)\b/.test(n)) return 'Siguiente bloque';
  /* «Tareas pendientes (orden de dependencia)» es la variante más extendida en el área:
   * cuenta como la sección Pendientes aunque D8 pida el título corto. */
  if (/^(?:tareas? )?pendientes?\b/.test(n)) return 'Pendientes';
  if (/^bloqueos?\b/.test(n)) return 'Bloqueos';
  if (/^planes? activos?\b/.test(n)) return 'Planes activos';
  return null;
}

/* Lee la linea de propiedades de una tarea. [por que] Tolerante con lo que falta —lo ausente es
 * el valor por defecto y no es problema— y estricto con lo que esta escrito: una propiedad mal
 * escrita que se ignorara en silencio seria una propiedad perdida, que es justo lo que la usuaria
 * no quiere. Devuelve lo reconocido y un motivo por cada cosa que no cuadra. */
function leerPropiedades(resto: string): { propiedades: PropiedadesTarea; motivos: string[] } {
  const propiedades: PropiedadesTarea = {};
  const motivos: string[] = [];
  const trozos = resto
    .split(' · ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (trozos.length === 0) return { propiedades, motivos: ['línea de propiedades vacía'] };

  for (const trozo of trozos) {
    const par = trozo.match(/^([\p{L}-]+)\s*:\s*(.+)$/u);
    if (!par) {
      motivos.push('par de propiedades a medias');
      continue;
    }
    const clave = par[1].toLowerCase();
    const valor = par[2].trim();
    if (!(CLAVES_PROPIEDAD as readonly string[]).includes(clave)) {
      motivos.push('propiedad desconocida');
      continue;
    }
    if (clave === 'prioridad' || clave === 'urgencia') {
      const validos = clave === 'prioridad' ? PRIORIDADES_TAREA : URGENCIAS_TAREA;
      if (!(validos as readonly string[]).includes(valor)) {
        motivos.push('valor fuera del conjunto');
        continue;
      }
      if (clave === 'prioridad') propiedades.prioridad = valor;
      else propiedades.urgencia = valor;
      continue;
    }
    if (clave === 'creada' || clave === 'pospuesta' || clave === 'completada') {
      if (!RE_FECHA.test(valor)) {
        motivos.push('fecha con forma inválida');
        continue;
      }
      propiedades[clave] = valor;
      continue;
    }
    /* Etiquetas y dependencias: lista separada por comas. */
    const lista = valor
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (lista.length === 0) {
      motivos.push('lista de propiedades vacía');
      continue;
    }
    if (clave === 'etiquetas') propiedades.etiquetas = lista;
    else propiedades.dependeDe = lista;
  }
  return { propiedades, motivos };
}

/** Analiza el texto de un roadmap con la forma del protocolo. */
export function analizarRoadmap(texto: string): AnalisisRoadmap {
  const lineas = texto.split(/\r?\n/);
  const tareas: TareaRoadmap[] = [];
  const problemas: ProblemaRoadmap[] = [];
  const noCanonicas: string[] = [];
  const planes: string[] = [];
  const encontradas = new Set<string>();
  const ids = new Set<string>();
  let enTareas = false;
  let enPlanes = false;
  let enCodigo = false;
  /* Tarea y subtarea en curso, y si ya les llego contenido sangrado: la linea de propiedades va
   * pegada a la suya, asi que una «·» despues del cuerpo esta fuera de sitio. */
  let tareaActual: TareaRoadmap | null = null;
  let subtareaActual: SubtareaRoadmap | null = null;
  let sangradoTarea = false;
  let sangradoSubtarea = false;

  lineas.forEach((cruda, i) => {
    const linea = cruda.replace(/\s+$/, '');
    const n = i + 1;
    for (const m of linea.match(RE_ID) ?? []) ids.add(m);
    if (/^\s*(```|~~~)/.test(linea)) {
      enCodigo = !enCodigo;
      return;
    }
    if (enCodigo) return;

    const h = linea.match(/^(#{2,4})\s+(.+)$/);
    if (h) {
      if (h[1].length === 2) {
        const canonica = seccionCanonica(h[2]);
        if (canonica) {
          encontradas.add(canonica);
          enTareas = canonica === 'Pendientes' || canonica === 'Siguiente bloque';
          enPlanes = canonica === 'Planes activos';
        } else {
          noCanonicas.push(h[2].trim());
          enTareas = RE_ZONA_TAREAS.test(normalizar(h[2]));
          enPlanes = false;
        }
      } else if (enTareas && RE_ID.test(h[2])) {
        problemas.push({ linea: n, texto: h[2].trim(), motivo: 'tarea escrita como heading' });
      } else if (enTareas && RE_ZONA_TAREAS.test(normalizar(h[2]))) {
        noCanonicas.push(h[2].trim());
      }
      /* Un heading cierra el bloque: lo que venga sangrado despues ya no es de la tarea anterior. */
      tareaActual = null;
      subtareaActual = null;
      return;
    }

    if (enPlanes) {
      const plan = linea.match(RE_PLAN);
      if (plan) planes.push(plan[1]);
      return;
    }

    /* Linea de propiedades: la indentacion dice de quien es (tarea +2, subtarea +2). */
    const props = linea.match(RE_PROPIEDADES);
    if (props) {
      const deTarea = sangria(linea) === 2 && tareaActual !== null && !sangradoTarea;
      const deSubtarea = sangria(linea) === 4 && subtareaActual !== null && !sangradoSubtarea;
      if (deTarea || deSubtarea) {
        const { propiedades, motivos } = leerPropiedades(props[1]);
        if (deTarea && tareaActual) {
          tareaActual.propiedades = propiedades;
          sangradoTarea = true;
        } else if (subtareaActual) {
          subtareaActual.propiedades = propiedades;
          sangradoSubtarea = true;
        }
        for (const motivo of motivos) problemas.push({ linea: n, texto: linea.trim(), motivo });
      } else {
        problemas.push({ linea: n, texto: linea.trim(), motivo: 'línea de propiedades fuera de sitio' });
      }
      return;
    }

    /* Lineas sangradas: subtarea de la tarea en curso, o cuerpo en prosa (que se ignora). */
    if (/^\s+\S/.test(linea)) {
      const sub = linea.match(RE_SUBTAREA);
      if (sub && sangria(linea) >= 2) {
        if (!tareaActual) {
          problemas.push({ linea: n, texto: linea.trim(), motivo: 'subtarea sin tarea padre' });
          return;
        }
        subtareaActual = { titulo: sub[3].trim(), completada: sub[2].toLowerCase() === 'x', linea: n, propiedades: {} };
        tareaActual.subtareas.push(subtareaActual);
        /* La subtarea tambien es contenido de la tarea: su linea «·» ya no es de la tarea. */
        sangradoTarea = true;
        sangradoSubtarea = false;
        return;
      }
      sangradoTarea = true;
      return;
    }

    const casilla = linea.match(RE_CASILLA);
    if (casilla) {
      const tarea = linea.match(RE_TAREA);
      if (tarea) {
        tareaActual = { id: tarea[1], titulo: nombreDeTitulo(tarea[2]), linea: n, propiedades: {}, subtareas: [] };
        tareas.push(tareaActual);
        subtareaActual = null;
        sangradoTarea = false;
        sangradoSubtarea = false;
      } else if (casilla[1] === ' ')
        problemas.push({ linea: n, texto: linea.trim(), motivo: 'casilla sin ID en la forma del protocolo' });
      else
        problemas.push({
          linea: n,
          texto: linea.trim(),
          motivo: 'tarea completada dentro del roadmap (va a Agente/completados/)',
        });
      return;
    }

    if (!enTareas) return;

    const item = linea.match(RE_ITEM_ID);
    if (item && RE_ID.test(item[1] ?? item[2] ?? '')) {
      problemas.push({ linea: n, texto: linea.trim(), motivo: 'tarea sin casilla' });
      return;
    }
    if (linea.startsWith('|') && RE_ID.test(linea)) {
      problemas.push({ linea: n, texto: linea.trim(), motivo: 'tarea en tabla' });
    }
  });

  /* [por que] El ID es la clave con la que el tab empareja una linea del roadmap con su tarea de
   * TASK: repetido, dos lineas se disputarian la misma tarea. */
  const primeraLinea = new Map<string, number>();
  for (const t of tareas) {
    if (!primeraLinea.has(t.id)) {
      primeraLinea.set(t.id, t.linea);
      continue;
    }
    problemas.push({ linea: t.linea, texto: t.id, motivo: 'ID repetido en el roadmap' });
  }
  /* En orden de documento: la consola agrupa por motivo y cita `roadmap.md:N`. */
  problemas.sort((a, b) => a.linea - b.linea);

  return {
    tareas,
    problemas,
    lineas: lineas.length,
    faltantes: SECCIONES_ROADMAP.filter((s) => !encontradas.has(s)),
    noCanonicas,
    planes,
    ids: [...ids].slice(0, TOPE_TAREAS),
  };
}

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
      activos: a.planes.length,
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
