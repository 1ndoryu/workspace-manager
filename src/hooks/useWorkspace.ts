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

/* Panel central y visibilidad de paneles (nav), persistidos igual que el
 * layout y la seleccion: sobreviven a recargas. [por que] El usuario pidio
 * un nav para cambiar el panel central (mapa/docs/repos/config) y controlar
 * que paneles laterales/consola estan visibles. */
export type PanelCentral = 'mapa' | 'docs' | 'repos' | 'navegador' | 'config';

/* Posicion del menu contextual (clic derecho) sobre un proyecto. La seleccion
 * usa el id (nombre) y la clave (ruta relativa) para ignorar/configurar. */
export interface MenuContextual {
  x: number;
  y: number;
  id: string;
  clave: string;
}

export interface VisibilidadPaneles {
  detalle: boolean;
  lista: boolean;
  consola: boolean;
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
    console.warn('[workspace] no se pudo leer la UI guardada:', err);
    return UI_DEFECTO;
  }
}

/* Leida una sola vez por carga de pagina. */
const uiInicial = uiGuardada();

function guardarUi(panelCentral: PanelCentral, visibles: VisibilidadPaneles): void {
  try {
    localStorage.setItem(CLAVE_UI, JSON.stringify({ panelCentral, visibles }));
  } catch (err) {
    console.warn('[workspace] no se pudo guardar la UI:', err);
  }
}

interface EstadoWorkspace {
  snapshot: SnapshotWorkspace | null;
  cargando: boolean;
  error: string | null;
  desdeCache: boolean;
  proyectoSeleccionado: string | null;
  vista: 'mapa' | 'lista' | 'agents';
  filtro: 'todos' | 'repos' | 'dirty' | 'conGate';
  buscar: string;
  panelCentral: PanelCentral;
  visibles: VisibilidadPaneles;
  navegadorRuta: string | null;
  /* Menu contextual (clic derecho) sobre un proyecto: posicion y clave. */
  menuContextual: MenuContextual | null;
  /* Proyecto que configura la pagina 'config' (se abre desde el menu). */
  proyectoAConfigurar: string | null;
  cargar: (forzar?: boolean) => Promise<void>;
  seleccionar: (id: string | null) => void;
  setFiltro: (f: EstadoWorkspace['filtro']) => void;
  setBuscar: (b: string) => void;
  setPanelCentral: (p: PanelCentral) => void;
  setPanelVisible: (clave: keyof VisibilidadPaneles, valor: boolean) => void;
  irAArchivos: (ruta: string) => void;
  consumirNavegadorRuta: () => void;
  abrirMenuContextual: (m: { x: number; y: number; id: string; clave: string }) => void;
  cerrarMenuContextual: () => void;
  configurarProyecto: (clave: string) => void;
  /* Ignorar / dejar de ignorar un proyecto por su clave y re-escanea. */
  cambiarIgnorado: (clave: string, ignorar: boolean) => Promise<void>;
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
  panelCentral: uiInicial.panelCentral,
  visibles: uiInicial.visibles,
  navegadorRuta: null,
  menuContextual: null,
  proyectoAConfigurar: null,

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
  setPanelCentral: (panelCentral) => {
    guardarUi(panelCentral, get().visibles);
    set({ panelCentral });
  },
  setPanelVisible: (clave, valor) => {
    const visibles = { ...get().visibles, [clave]: valor };
    guardarUi(get().panelCentral, visibles);
    set({ visibles });
  },
  /* Abre la carpeta de un proyecto en el navegador de archivos: cambia el
   * panel central a 'navegador' y deja la ruta objetivo para el panel. */
  irAArchivos: (ruta) => {
    guardarUi('navegador', get().visibles);
    set({ panelCentral: 'navegador', navegadorRuta: ruta });
  },
  consumirNavegadorRuta: () => set({ navegadorRuta: null }),
  abrirMenuContextual: (m) => {
    set({ menuContextual: m });
    /* [por que] El clic derecho tambien selecciona el proyecto, igual que el
     * clic izquierdo, para que 'configurar' actue sobre el correcto. */
    get().seleccionar(m.id);
  },
  cerrarMenuContextual: () => set({ menuContextual: null }),
  configurarProyecto: (clave) => {
    set({ menuContextual: null, proyectoAConfigurar: clave });
    get().setPanelCentral('config');
  },
  cambiarIgnorado: async (clave, ignorar) => {
    try {
      const { data } = await axios.post<{ ok: boolean; snapshot?: SnapshotWorkspace }>('/api/config', {
        op: ignorar ? 'ignorar' : 'quitar',
        clave,
      });
      /* [por que] El server devuelve el snapshot ya mutado (ignorar/quitar
       * solo cambia visibilidad, no requiere re-escaneo completo). Se aplica
       * directo: la UI se actualiza al instante sin esperar el escaneo git
       * (~2.6s) que antes se hacia dos veces (server + cliente). */
      if (data.snapshot) set({ snapshot: data.snapshot, desdeCache: false });
    } catch (err) {
      const detalle = (err as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle;
      throw new Error(detalle ?? 'no se pudo guardar la config');
    }
  },
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
