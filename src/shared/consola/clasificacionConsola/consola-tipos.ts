/* Tipos de la clasificación de problemas de la consola. Sin lógica ni E/S: lo usan
 * todas las clasificaciones por fuente. */
import type { Proyecto } from '../../types.js';

export type Categoria = 'sinGit' | 'sinCommit' | 'sinPush' | 'gate' | 'config' | 'sentinel' | 'huerfano' | 'vulnerabilidad' | 'dev' | 'salud' | 'taller' | 'pendiente';

/* Severidad real del hallazgo de sentinel (analyze); solo la categoria
 * 'sentinel' la usa. El badge del proyecto y de la linea deriva de aqui. */
export type SeveridadSentinel = 'error' | 'warning' | 'information' | 'hint';

export interface Entrada {
  categoria: Categoria;
  motivo: string;
  /* Severidad real del problema. Solo la categoria 'config' distingue
   * error/advertencia; el resto es null (no aplica). */
  seriedad: 'error' | 'advertencia' | null;
  /* Severidad del hallazgo de sentinel (analyze), p. ej. error/warning/information/
   * hint. Null salvo en la categoria 'sentinel'. */
  sentinelSeveridad?: SeveridadSentinel;
  /* Severidad de la vulnerabilidad de dependencias (critical/high/moderate/low).
   * Null salvo en la categoria 'vulnerabilidad'. */
  vulnSeveridad?: SeveridadVuln;
  /* Id de la entrada del registro del mando dev (F3: el tablero lo usa para
   * up/stop/logs/open). Solo en entradas 'dev' de deriva; sin-boton/no-aplica,
   * bajo-mando y el resto de categorias no lo llevan.
   * `parado` (05AA-4) no genera entrada: detenido normal no va en
   * problemas; se opera desde el detalle (clic en la caja). */
  devId?: string | null;
  /* Bandera `permanente` de la ficha, solo en la linea del mando dev: la consola pinta la casilla
   * «permanente» junto a los botones sin releer el registro. Ausente = falsa. */
  devPermanente?: boolean;
}

/* Severidad de una vulnerabilidad de dependencias (npm/pnpm/cargo audit). */
export type SeveridadVuln = 'critical' | 'high' | 'moderate' | 'low';

/* Un proyecto con sus problemas. Cada problema (Entrada) es una linea
 * individual: el CONTEO es por entrada, no por proyecto, porque un proyecto
 * puede tener varios (p. ej. 5 opciones mal de config). Las categorias de
 * badges se derivan de las entradas (unicas). */
export interface Problema {
  p: Proyecto;
  entradas: Entrada[];
}
