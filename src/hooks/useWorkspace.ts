/* Store global del workspace con zustand.
 * [por que] Estado global minimo: snapshot del area + seleccion + filtros.
 * Selectores especificos (no el store completo) en los componentes. */
import { create } from 'zustand';
import axios from 'axios';
import type { Proyecto, SnapshotWorkspace } from '../shared/types.js';

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
    console.warn('[workspace] no se pudo leer la seleccion guardada:', err);
    return null;
  }
}

/* Leida una sola vez por carga de pagina para inicializar la seleccion. */
const seleccionInicial = seleccionGuardada();

interface EstadoWorkspace {
  snapshot: SnapshotWorkspace | null;
  cargando: boolean;
  error: string | null;
  desdeCache: boolean;
  proyectoSeleccionado: string | null;
  vista: 'mapa' | 'lista' | 'agents';
  filtro: 'todos' | 'repos' | 'dirty' | 'conGate';
  buscar: string;
  cargar: (forzar?: boolean) => Promise<void>;
  seleccionar: (id: string | null) => void;
  setFiltro: (f: EstadoWorkspace['filtro']) => void;
  setBuscar: (b: string) => void;
}

export const useWorkspaceStore = create<EstadoWorkspace>((set, get) => ({
  snapshot: null,
  cargando: false,
  error: null,
  desdeCache: false,
  proyectoSeleccionado: seleccionInicial,
  vista: 'mapa',
  filtro: 'todos',
  buscar: '',

  cargar: async (forzar = false) => {
    set({ cargando: true, error: null });
    try {
      const { data } = await axios.get<SnapshotWorkspace & { desdeCache?: boolean }>(
        `/api/workspace${forzar ? '?forzar=1' : ''}`,
      );
      set({
        snapshot: data,
        desdeCache: data.desdeCache ?? false,
        cargando: false,
      });
    } catch (err) {
      set({
        cargando: false,
        error: err instanceof Error ? err.message : 'Error al cargar el workspace',
      });
    }
  },

  seleccionar: (id) => {
    /* Persiste la seleccion en cada cambio para que sobreviva a recargas. */
    try {
      if (id === null) {
        localStorage.removeItem(CLAVE_SELECCION);
      } else {
        localStorage.setItem(CLAVE_SELECCION, id);
      }
    } catch (err) {
      console.warn('[workspace] no se pudo guardar la seleccion:', err);
    }
    set({ proyectoSeleccionado: id });
  },
  setFiltro: (filtro) => set({ filtro }),
  setBuscar: (buscar) => set({ buscar }),
}));

/* Selectores derivados: lista filtrada por estado + busqueda. */
export function proyectosFiltrados(state: EstadoWorkspace): Proyecto[] {
  const proyectos = state.snapshot?.proyectos ?? [];
  const filtro = state.filtro;
  const buscar = state.buscar.trim().toLowerCase();

  return proyectos.filter((p) => {
    if (filtro === 'repos' && !p.esGit) return false;
    if (filtro === 'dirty' && !p.git?.dirty) return false;
    if (filtro === 'conGate' && !p.gate?.declarado) return false;
    if (buscar && !p.id.toLowerCase().includes(buscar)) return false;
    return true;
  });
}
