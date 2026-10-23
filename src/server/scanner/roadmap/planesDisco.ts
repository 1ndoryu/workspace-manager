/* Planes vivos según su ubicación en disco. Único punto que decide «este plan sigue abierto»:
 * todo `.md` bajo `Agente/planes/` que no esté bajo `completados/`.
 *
 * [por que] Hasta 2026-10-23 el tablero los sacaba del bloque «Planes activos» del roadmap.md.
 * Cuando la tarea asociada se movió a otra sección sin casilla (`03AA-5`), el enlace desapareció
 * del MD y el plan se volvió invisible aunque seguía en disco: la usuaria lo buscaba y parecía
 * borrado. La ubicación es la fuente; el MD solo lo describe. */
import { readdirSync, statSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { leerArchivo } from '../../http.js';

export interface PlanActivo {
  /* Ruta relativa a `Agente/planes/`, con `/` siempre: es la que se compara con el roadmap. */
  archivo: string;
  modificadoMs: number;
  /* Casillas `- [ ]` sin marcar, más una si el roadmap lo declara en «Planes activos».
   * [por que] Un plan con trabajo abierto está activo aunque lleve días sin tocarse: la alarma
   * por antigüedad solo vale si ya no queda nada abierto. */
  abiertas: number;
}

/* Un plan archivado: cualquier ruta con una carpeta `completados` en el camino. */
const ARCHIVADA = /(^|[\\/])completados[\\/]/;

/* Trabajo abierto de un plan: sus casillas sin marcar (`- [ ]`, `* [ ]`) y, si el roadmap lo
 * declara en «Planes activos», al menos una más. [por que] El roadmap solo lista trabajo
 * abierto (D8): un plan declarado sigue activo aunque use pasos numerados (F4.1, F4.2) en vez
 * de casillas. Contarlo como cerrado daba un «ciérralo» falso. */
export function abiertasDelPlan(texto: string, declarados: string[], archivo: string): number {
  const casillas = texto.match(/^\s*[-*]\s\[ \]/gm)?.length ?? 0;
  const nombre = basename(archivo);
  return casillas + (declarados.some((d) => basename(d) === nombre) ? 1 : 0);
}

/* Planes vivos del proyecto, en orden de ruta. Sin `Agente/planes/`: no hay ninguno. */
export function planesEnDisco(ruta: string, declarados: string[] = []): PlanActivo[] {
  const dir = join(ruta, 'Agente', 'planes');
  let relativas: string[];
  try {
    /* Recursivo: un plan puede vivir en una subcarpeta (`fase-d-bdp-local-2026-10-10/`). */
    relativas = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  return relativas
    .filter((rel) => rel.endsWith('.md') && basename(rel) !== 'README.md' && !ARCHIVADA.test(rel))
    .sort()
    .map((rel) => {
      const completa = join(dir, rel);
      /* README.md es el índice de la carpeta, no un plan: queda fuera de la comprobación. */
      const archivo = rel.split(sep).join('/');
      return {
        archivo,
        modificadoMs: statSync(completa).mtimeMs,
        abiertas: abiertasDelPlan(leerArchivo(completa) ?? '', declarados, archivo),
      };
    });
}
