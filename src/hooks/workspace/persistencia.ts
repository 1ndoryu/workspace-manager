/* Persistencia local de seleccion y layout del shell.
 * [por que] El usuario pidio que la seleccion y el nav sobrevivan a recargas,
 * igual que el zoom/pan del mapa. Vive fuera del store para que el slice sea
 * testeable sin zustand: solo localStorage + logger. */
import type { PanelCentral, VisibilidadPaneles } from './tipos.js';
import { borrarClave, guardarJson, guardarTexto, leerJson, leerTexto } from '../../shared/storage.js';

/* Persistencia de la seleccion entre recargas, igual que zoom/pan del mapa.
 * [por que] El usuario pidio que el panel/caja seleccionada perdure al
 * recargar. Se guarda el id en localStorage; si no hay nada o falla el
 * almacenamiento, se parte sin seleccion. */
const CLAVE_SELECCION = 'workspaceManager:seleccion';

function seleccionGuardada(): string | null {
  return leerTexto(CLAVE_SELECCION, 'no se pudo leer la seleccion guardada:') || null;
}

/* Leida una sola vez por carga de pagina para inicializar la seleccion. */
export const seleccionInicial = seleccionGuardada();

/* Persiste la seleccion en cada cambio para que sobreviva a recargas. */
export function guardarSeleccion(id: string | null): void {
  if (id === null) {
    borrarClave(CLAVE_SELECCION, 'no se pudo guardar la seleccion:');
  } else {
    guardarTexto(CLAVE_SELECCION, id, 'no se pudo guardar la seleccion:');
  }
}

const CLAVE_UI = 'workspaceManager:ui';
const UI_DEFECTO = {
  panelCentral: 'mapa' as PanelCentral,
  visibles: { detalle: true, lista: true, consola: true } as VisibilidadPaneles,
};

function uiGuardada(): { panelCentral: PanelCentral; visibles: VisibilidadPaneles } {
  const d = leerJson<{ panelCentral?: unknown; visibles?: Partial<VisibilidadPaneles> }>(
    CLAVE_UI,
    'no se pudo leer la UI guardada:',
  );
  if (!d) return UI_DEFECTO;
  const panelCentral: PanelCentral =
    d.panelCentral === 'docs' ||
    d.panelCentral === 'repos' ||
    d.panelCentral === 'tareas' ||
    d.panelCentral === 'navegador' ||
    d.panelCentral === 'config' ||
    d.panelCentral === 'sentinel' ||
    d.panelCentral === 'pc' ||
    d.panelCentral === 'vps'
      ? d.panelCentral
      : 'mapa';
  const visibles: VisibilidadPaneles = { ...UI_DEFECTO.visibles, ...(d.visibles ?? {}) };
  for (const k of ['detalle', 'lista', 'consola'] as const) {
    visibles[k] = typeof visibles[k] === 'boolean' ? visibles[k] : true;
  }
  return { panelCentral, visibles };
}

/* Leida una sola vez por carga de pagina. */
export const uiInicial = uiGuardada();

export function guardarUi(panelCentral: PanelCentral, visibles: VisibilidadPaneles): void {
  guardarJson(CLAVE_UI, { panelCentral, visibles }, 'no se pudo guardar la UI:');
}
