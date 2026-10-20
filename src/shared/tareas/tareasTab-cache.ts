/* Foto local del kanban (partido de tareasTab.ts): clonar y restaurar con los mismos guardianes
 * que la red. El hook decide cuando guardar y cuando leer. */
import type { CacheTareasTab, ColumnaTab, TareasEstado, TareaTab } from './tareasTab-tipos.js';
import { baseDeEstado, esColumnaTab, esTareaTab } from './tareasTab-modelo.js';

export function clonarCacheTareas(
  estado: TareasEstado,
  columnas: ColumnaTab[],
  tareas: Record<number, TareaTab[]>,
): CacheTareasTab {
  const copia: Record<number, TareaTab[]> = {};
  for (const [k, lista] of Object.entries(tareas)) {
    if (!Array.isArray(lista)) continue;
    copia[Number(k)] = lista.filter(esTareaTab);
  }
  return {
    guardadoEn: Date.now(),
    estado: {
      configurado: estado.configurado === true,
      disponible: estado.disponible === true,
      motivo: typeof estado.motivo === 'string' ? estado.motivo : null,
      base: baseDeEstado(estado.base),
    },
    columnas: columnas.filter(esColumnaTab).map((c) => ({ clave: c.clave, nombre: c.nombre, legacyId: c.legacyId })),
    tareas: copia,
  };
}

export function restaurarCacheTareas(v: unknown): CacheTareasTab | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (!Number.isInteger(c.guardadoEn)) return null;
  if (typeof c.estado !== 'object' || c.estado === null) return null;
  const e = c.estado as Record<string, unknown>;
  if (typeof e.configurado !== 'boolean' || typeof e.disponible !== 'boolean') return null;
  if (!Array.isArray(c.columnas) || !c.columnas.every(esColumnaTab)) return null;
  if (typeof c.tareas !== 'object' || c.tareas === null || Array.isArray(c.tareas)) return null;
  const tareas: Record<number, TareaTab[]> = {};
  for (const [k, lista] of Object.entries(c.tareas as Record<string, unknown>)) {
    if (!Number.isInteger(Number(k)) || !Array.isArray(lista)) return null;
    tareas[Number(k)] = lista.filter(esTareaTab);
  }
  return {
    guardadoEn: c.guardadoEn as number,
    estado: {
      configurado: e.configurado as boolean,
      disponible: e.disponible as boolean,
      motivo: typeof e.motivo === 'string' ? (e.motivo as string) : null,
      // [por que] Las caches guardadas antes de existir `base` se restauran sin
      // enlace, no se descartan: la tab cae al valor por defecto.
      base: baseDeEstado(e.base),
    },
    columnas: (c.columnas as ColumnaTab[]).map((col) => ({ clave: col.clave, nombre: col.nombre, legacyId: col.legacyId })),
    tareas,
  };
}
