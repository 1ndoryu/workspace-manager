/* Funciones puras del proveedor de reglas: orden semver, filtro de prerelease y normalización
 * de una regla del runtime. Sin IO: se prueban sin disco ni runtime. proveedor.ts las usa y
 * no las reexporta, así que los importadores no cambian.
 * [por que] Separadas de proveedor.ts para que ese archivo quede bajo 300 líneas (gate limite-lineas). */
import type { ReglaCatalogo, SeveridadRegla } from '../../../../shared/gate/catalogo/reglas.js';

/* Versión semver comparada por partes numericas. [por que] Al elegir entre
 * varias versiones instaladas se prefiere la mas alta ESTABLE (sin sufijo
 * -alpha/-beta). La regla del proyecto es la version fijada; si no hay lock
 * que la fije, la mas alta estable es la fuente de verdad. */
export function semverSort(a: string, b: string): number {
  const pa = a.split(/[.\-]/).map(Number);
  const pb = b.split(/[.\-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export function esPrerelease(v: string): boolean {
  return /-(alpha|beta|rc|next|dev|pre)/i.test(v);
}

/* Mapea la categoria (string) del runtime a id legible conocido o el propio.
 * [por que] obtenerTodasLasReglas() devuelve `categoria` como string; los ids
 * coinciden con CATEGORIAS_REGLAS, pero se normaliza por si el runtime los
 * cambia, sin hardcodear la lista en el proveedor. */
export function normalizar(regla: Record<string, unknown>, habilitadaDefault: boolean): ReglaCatalogo {
  const severidad = String(regla.severidad ?? regla.severidadDefault ?? 'warning') as SeveridadRegla;
  return {
    id: String(regla.id),
    nombre: String(regla.nombre ?? regla.id),
    categoria: String(regla.categoria ?? 'general'),
    habilitada: typeof regla.habilitada === 'boolean'
      ? regla.habilitada
      : habilitadaDefault,
    severidad,
  };
}
