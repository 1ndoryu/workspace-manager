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
