/* Persistencia local de seleccion y layout del shell.
 * [por que] El usuario pidio que la seleccion y el nav sobrevivan a recargas,
 * igual que el zoom/pan del mapa. Vive fuera del store para que el slice sea
 * testeable sin zustand: solo localStorage + logger. */
import type { PanelCentral, VisibilidadPaneles } from './tipos.js';
import { logger } from '../../shared/logger.js';

/* Persistencia de la seleccion entre recargas, igual que zoom/pan del mapa.
 * [por que] El usuario pidio que el panel/caja seleccionada perdure al
 * recargar. Se guarda el id en localStorage; si no hay nada o falla el
 * almacenamiento, se parte sin seleccion. */
const CLAVE_SELECCION = 'workspaceManager:seleccion';

function seleccionGuardada(): string | null {
  try {
    const raw = localStorage.getItem(CLAVE_SELECCION);
    return raw || null;
  } catch (err) {
    logger.warn('no se pudo leer la seleccion guardada:', err);
    return null;
  }
}

/* Leida una sola vez por carga de pagina para inicializar la seleccion. */
export const seleccionInicial = seleccionGuardada();

/* Persiste la seleccion en cada cambio para que sobreviva a recargas. */
export function guardarSeleccion(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(CLAVE_SELECCION);
    } else {
      localStorage.setItem(CLAVE_SELECCION, id);
    }
  } catch (err) {
    logger.warn('no se pudo guardar la seleccion:', err);
  }
}

const CLAVE_UI = 'workspaceManager:ui';
const UI_DEFECTO = {
  panelCentral: 'mapa' as PanelCentral,
  visibles: { detalle: true, lista: true, consola: true } as VisibilidadPaneles,
};

function uiGuardada(): { panelCentral: PanelCentral; visibles: VisibilidadPaneles } {
  try {
    const raw = localStorage.getItem(CLAVE_UI);
    if (!raw) return UI_DEFECTO;
    const d = JSON.parse(raw) as { panelCentral?: unknown; visibles?: Partial<VisibilidadPaneles> };
    const panelCentral: PanelCentral =
      d.panelCentral === 'docs' ||
      d.panelCentral === 'repos' ||
      d.panelCentral === 'navegador' ||
      d.panelCentral === 'config'
        ? d.panelCentral
        : 'mapa';
    const visibles: VisibilidadPaneles = { ...UI_DEFECTO.visibles, ...(d.visibles ?? {}) };
    for (const k of ['detalle', 'lista', 'consola'] as const) {
      visibles[k] = typeof visibles[k] === 'boolean' ? visibles[k] : true;
    }
    return { panelCentral, visibles };
  } catch (err) {
    logger.warn('no se pudo leer la UI guardada:', err);
    return UI_DEFECTO;
  }
}

/* Leida una sola vez por carga de pagina. */
export const uiInicial = uiGuardada();

export function guardarUi(panelCentral: PanelCentral, visibles: VisibilidadPaneles): void {
  try {
    localStorage.setItem(CLAVE_UI, JSON.stringify({ panelCentral, visibles }));
  } catch (err) {
    logger.warn('no se pudo guardar la UI:', err);
  }
}
