/* Lectura linea a linea del roadmap: sangria, normalizacion de titulos de seccion y linea de
 * propiedades. Pura: no conoce el documento entero, solo cada linea. */
import { PRIORIDADES_TAREA, URGENCIAS_TAREA } from '../../../../shared/tareas/tareasTab.js';
import { CLAVES_PROPIEDAD, type PropiedadesTarea } from './analisis-tipos.js';

/* Fecha en forma ISO corta: es la que escribe el tab. */
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/* Espacios de sangria al principio de una linea. */
export function sangria(linea: string): number {
  return linea.match(/^\s*/)?.[0].length ?? 0;
}

/* Normaliza un titulo de seccion: sin numeracion, sin signos ni emoji, en minusculas y con
 * espacios simples. [por que] Los headings reales llevan adornos («## 6. Desarrollo pendiente»,
 * «## 🔴 Pendiente crítico», «## Pendientes (orden de dependencia)»). */
export function normalizar(texto: string): string {
  return texto
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* Seccion canonica a la que corresponde un titulo, o null si no es ninguna. Casa por prefijo
 * para admitir el singular y el plural («Pendiente»/«Pendientes») y los adornos. */
export function seccionCanonica(titulo: string): string | null {
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
export function leerPropiedades(resto: string): { propiedades: PropiedadesTarea; motivos: string[] } {
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
