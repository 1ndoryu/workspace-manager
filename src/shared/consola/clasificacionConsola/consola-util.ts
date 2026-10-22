/* Utilidades puras de la consola: conteo, categorias y ruta relativa de un proyecto.
 * [por que] Salen del barrel clasificacionConsola.ts (19AA-13): un barrel solo
 * reexporta y estas funciones tienen lógica propia. */
import type { Categoria, Entrada, Problema } from './consola-tipos.js';

/* Cuenta todas las entradas que la consola muestra, para que el contador y el
 * total del tablero coincidan con lo que se ve. Unico punto de conteo: servidor
 * (/api/consola/problemas) y cliente (consola) lo usan igual. */
export function contarProblemas(entradas: Entrada[]): number {
  return entradas.length;
}

/* Categorias unicas de un proyecto (para sus badges), en orden fijo. */
export function categoriasDe(pr: Problema): Categoria[] {
  const orden: Categoria[] = ['sinGit', 'sinCommit', 'sinPush', 'gate', 'config', 'sentinel', 'vulnerabilidad', 'huerfano', 'dev', 'salud', 'taller', 'pendiente'];
  return orden.filter((c) => pr.entradas.some((e) => e.categoria === c));
}

/* Huella de un motivo: lo que lo identifica sin lo que solo fluctua. [por que] Numeros (lineas,
 * pids, contadores, puertos) cambian sin que el problema cambie; las tildes y las mayusculas, igual.
 * El unico sitio que la calcula es este: la campana, la consola y el diff la leen de aqui para no
 * numerar distinto (20AA-30 N4-1). */
export function huellaMotivo(motivo: string): string {
  return motivo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/* Pone `huella` a cada entrada de cada grupo. [por que en el agrupado y no en cada clasificador]
 * La identidad es `categoria|huella del motivo` DENTRO del grupo, y solo quien tiene la lista
 * completa puede resolver los empates; con `huella` en los trece sitios que crean entradas, el
 * criterio acabaria escrito trece veces y distinto. Sin repetidos en el grupo, la huella es
 * bonita de leer; con ellos, se numera por orden de aparicion (`…~1`, `…~2`). */
export function marcarHuellas<T extends { entradas: Entrada[] }>(grupos: T[]): T[] {
  for (const g of grupos) {
    const usadas = new Map<string, number>();
    for (const e of g.entradas) {
      const base = `${e.categoria}|${huellaMotivo(e.motivo)}`;
      const n = usadas.get(base) ?? 0;
      usadas.set(base, n + 1);
      e.huella = n === 0 ? base : `${base}~${n}`;
    }
  }
  return grupos;
}

/* Ruta relativa de un proyecto respecto a la raiz del area, para abrir su
 * carpeta en el navegador de archivos. Fuera del area devuelve ''. */
export function rutaRelativa(raiz: string | undefined, rutaAbs: string): string {
  if (!raiz) return '';
  const base = raiz.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = rutaAbs.replace(/\\/g, '/');
  if (r === base) return '';
  if (r.startsWith(base + '/')) return r.slice(base.length + 1);
  return '';
}
