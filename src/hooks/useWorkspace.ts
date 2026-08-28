/* Store global del workspace con zustand.
 * [por que] Estado global minimo: snapshot del area + seleccion + filtros.
 * Selectores especificos (no el store completo) en los componentes. */
import { create } from 'zustand';
import axios from 'axios';
import type { Proyecto, SnapshotWorkspace } from '../shared/types.js';

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
  proyectoSeleccionado: null,
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

  seleccionar: (id) => set({ proyectoSeleccionado: id }),
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
