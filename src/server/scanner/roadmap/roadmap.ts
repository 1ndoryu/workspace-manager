/* Analisis del roadmap.md segun el protocolo (D8 de AGENTS-detalle.md).
 * [por que] El roadmap es la fuente de trabajo abierto del area, pero hasta 2026-10-19 cada
 * proyecto lo escribia a su manera (casillas sueltas, negritas, tablas, headings) y el tablero
 * solo contaba casillas: no podia decir si habia trabajo pendiente ni avisar de que el formato
 * se salia del protocolo. Forma canonica de una tarea, al primer nivel:
 *   - [ ] `ID` — **Titulo.**
 * [gotcha] El analisis es estricto a proposito: lo que no tenga esa forma NO cuenta como tarea
 * (sale como problema de formato) en vez de adivinarse. Las lineas sangradas son sub-pasos de
 * la tarea y se ignoran, igual que los bloques de codigo. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResumenRoadmap } from '../../../shared/types.js';

/** Secciones fijas del roadmap (D8), en orden. */
export const SECCIONES_ROADMAP = ['Siguiente bloque', 'Pendientes', 'Bloqueos', 'Planes activos'];

/** Tope de lineas: pasarlo significa tener demasiado abierto (D8). */
export const TOPE_LINEAS_ROADMAP = 400;

/* IDs usados en el area: {DD}{M}{A}-{N} (297A-4, 19AA-4), H-<dominio>-<n>-<m> (H-F12-14) y
 * fases cortas (F0, T7, S17, R2). */
const RE_ID = /\b(?:\d{2,3}[A-C][A-Z]?-\d+|[A-Z]-[A-Z]+\d+-\d+|[A-Z]{1,3}\d+)\b/;

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

export interface TareaRoadmap {
  id: string;
  titulo: string;
  linea: number;
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
      return;
    }

    if (enPlanes) {
      const plan = linea.match(RE_PLAN);
      if (plan) planes.push(plan[1]);
      return;
    }

    /* Sub-pasos sangrados de una tarea: no son tareas del roadmap. */
    if (/^\s+\S/.test(linea)) return;

    const casilla = linea.match(RE_CASILLA);
    if (casilla) {
      const tarea = linea.match(RE_TAREA);
      if (tarea) tareas.push({ id: tarea[1], titulo: tarea[2].trim(), linea: n });
      else if (casilla[1] === ' ')
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

  return {
    tareas,
    problemas,
    lineas: lineas.length,
    faltantes: SECCIONES_ROADMAP.filter((s) => !encontradas.has(s)),
    noCanonicas,
    planes,
    ids: [...ids].slice(0, 40),
  };
}

const VACIO: ResumenRoadmap = {
  pendientes: 0,
  activos: 0,
  ids: [],
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
