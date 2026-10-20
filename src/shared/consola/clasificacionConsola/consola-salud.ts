/* Clasificación de la salud (F8) y de la conformidad del taller: hallazgos de un proyecto,
 * del área y del taller. Pura: los resultados llegan ya calculados. */
import type { Proyecto } from '../../types.js';
import { CLAVE_AREA, type ResultadoSalud } from '../../salud/salud.js';
import type { Hallazgo } from '../../taller/conformidad.js';
import type { Entrada, Problema } from './consola-tipos.js';

/* Hallazgos de salud (10AA-2 F8) de un proyecto o del área. Cada hallazgo es una
 * entrada en la categoría 'salud'. [por que] `error` cuenta como error y `aviso` como
 * advertencia; `info` (plan parado, enlace roto) se ve sin seriedad, como hint de sentinel. */
export function problemasSaludDe(p: Proyecto, s: ResultadoSalud | undefined): Problema | null {
  if (!s || s.hallazgos.length === 0) return null;
  const entradas: Entrada[] = s.hallazgos.map((h) => ({
    categoria: 'salud',
    motivo: `${h.mensaje} — ${h.accion}`,
    seriedad: h.severidad === 'error' ? 'error' : h.severidad === 'aviso' ? 'advertencia' : null,
  }));
  return { p, entradas };
}

/* Grupo sintético del área en la consola (clave CLAVE_AREA): nunca participa en
 * selección, igual que los huérfanos sin proyecto. */
export function problemaSaludArea(s: ResultadoSalud | undefined): Problema | null {
  /* [por que] ruta = CLAVE_AREA: el cliente agrupa por ruta; con '' colisionaria
   * con cualquier otro grupo de ruta vacia (p. ej. huerfanos). */
  return problemasSaludDe({ id: '(área)', clave: CLAVE_AREA, ruta: CLAVE_AREA, esGit: false, tipo: 'carpeta' }, s);
}

/* Hallazgos de conformidad del taller (S3, plan sucesor 2026-10-14) en el grupo del área.
 * [por que] Cada hallazgo lleva su ID de regla (A1, P2, L3...) para que la consola diga qué
 * falla sin abrir el código. */
export function problemasTallerDe(hallazgos: Hallazgo[] | undefined): Problema | null {
  if (!hallazgos || hallazgos.length === 0) return null;
  const entradas: Entrada[] = hallazgos.map((h) => ({
    categoria: 'taller',
    motivo: `${h.id} ${h.detalle} — ${h.remedio}`,
    seriedad: h.severidad,
  }));
  return { p: { id: '(área)', clave: CLAVE_AREA, ruta: CLAVE_AREA, esGit: false, tipo: 'carpeta' }, entradas };
}
