/* Store global del workspace con zustand.
 * [por que] Estado global minimo: snapshot del area + seleccion + filtros.
 * Selectores especificos (no el store completo) en los componentes. */
import { create } from 'zustand';
import axios from 'axios';
import type {
  AnalisisSentinel,
  AnalisisVulnerabilidades,
  ConfigScan,
  ConfigWorkspace,
  Proyecto,
  SnapshotWorkspace,
} from '../shared/types.js';
import type { ReglaCatalogo } from '../shared/gate/reglas.js';
import { REGLAS as REGLAS_ESTATICAS } from '../shared/gate/reglas.js';
import type { NodoEsquema } from '../shared/gate/esquema.js';
import type { TipoGate } from '../shared/gate/proveedores.js';
import { ESQUEMA_SENTINEL } from '../shared/gate/sentinel.js';
import { ESQUEMA_VARSENSE } from '../shared/gate/varsense.js';
import { deserializarEsquema } from '../shared/gate/serial.js';

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
  /* Catalogo de reglas del gate desde /api/gate/reglas (vivo) con fallback
   * al estatico embebido si el server no lo entrega. [por que] El plan
   * gate-dinamico R1: el cliente es 'tonto', pide el catalogo una vez y lo
   * cachea en el store; el server resuelve el runtime sentinel. */
  reglasCatalogo: { version: string; fuente: 'runtime' | 'estatica'; reglas: ReglaCatalogo[] };
  /* Esquemas de config por herramienta (sentinel/varsense), servidos por la
   * API /gate/dinamico (E1 gate-dinamico). El cliente deja de importar los
   * ESQUEMA_* estaticos en el bundle; el server resuelve y aqui se cachea. */
  esquemas: Partial<Record<TipoGate, NodoEsquema>>;
  /* Analisis real de sentinel por proyecto (plan analisis-sentinel-consola):
   * el server es el dueno de la ejecucion y aqui solo se cachean resultados
   * para que la consola cuente/agrupe sin volver a preguntar. */
  analisis: Record<string, AnalisisSentinel>;
  /* Indica si hay un barrido de analisis en curso (para el auto-timer: nunca
   * lanza un segundo barrido si ya hay uno — single-flight). */
  analizando: boolean;
  escanearUno: (clave: string, forzar?: boolean) => Promise<AnalisisSentinel>;
  /* Barrido serial del workspace (auto-timer y boton 'Escanea todo'). */
  escanearTodo: (forzar?: boolean) => Promise<void>;
  /* Vulnerabilidades de dependencias (plan 308A-4 V1): cache por proyecto.
   * El server resuelve gestor/lockfile y aqui solo se guardan resultados. */
  vulnerabilidades: Record<string, AnalisisVulnerabilidades>;
  /* Single-flight del barrido de vulnerabilidades (igual que analizando). */
  auditando: boolean;
  auditarUno: (clave: string, forzar?: boolean) => Promise<AnalisisVulnerabilidades>;
  auditarTodo: (forzar?: boolean) => Promise<void>;
  cargarVulnerabilidades: () => Promise<void>;
  configurarScan: (scan: ConfigScan) => Promise<void>;
  cargar: (forzar?: boolean) => Promise<void>;
  cargarReglas: () => Promise<void>;
  cargarEsquema: (tool: TipoGate) => Promise<NodoEsquema | undefined>;
  /* Rehidrata el estado de analisis desde la cache persistida del server al
   * arrancar, para que al recargar no se pierda la info ya analizada. */
  cargarAnalisis: () => Promise<void>;
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
  /* Eximir / quitar la exencion de gate de glory-sentinel (plan 308A-1 F6). */
  cambiarSinGate: (clave: string, eximir: boolean) => Promise<void>;
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
  reglasCatalogo: { version: '—', fuente: 'estatica', reglas: REGLAS_ESTATICAS },
  esquemas: {},
  analisis: {},
  analizando: false,
  vulnerabilidades: {},
  auditando: false,
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

  /* [por que] Solo se pide una vez por sesion: el catalogo esta cacheado por
   * version+mtime en el server, asi que repetir el GET no cuesta. Si falla,
   * queda el estatico embebido (ya inicializado) y se avisa por consola. */
  cargarReglas: async () => {
    try {
      const { data } = await axios.get<{
        version: string;
        fuente: 'runtime' | 'estatica';
        reglas: ReglaCatalogo[];
      }>('/api/gate/reglas');
      if (Array.isArray(data.reglas)) {
        set({ reglasCatalogo: { version: data.version, fuente: data.fuente, reglas: data.reglas } });
      }
    } catch (err) {
      console.warn('[workspace] catalogo de reglas vive no disponible, uso estatico:', err);
    }
  },

  /* [por que] Devuelve el esquema de config de una herramienta servido por la
   * API /gate/dinamico (el server resuelve el proveedor y sirve el esquema
   * SERIALIZADO con ciclos resueltos a refs); se rehidrata y cachea en el
   * store. Si ya esta, no repite. Si el fetch falla, cae al esquema estatico
   * embebido del bundle (fallback tolerante a fallos del plan E1). */
  cargarEsquema: async (tool) => {
    const ya = get().esquemas[tool];
    if (ya) return ya;
    const estatico = (t: TipoGate): NodoEsquema | undefined =>
      t === 'sentinel' ? ESQUEMA_SENTINEL() : t === 'varsense' ? ESQUEMA_VARSENSE() : undefined;
    try {
      const { data } = await axios.get<{ esquema: unknown }>(
        `/api/gate/dinamico?tool=${encodeURIComponent(tool)}`,
      );
      if (data && typeof data.esquema === 'object' && data.esquema !== null) {
        const nodo = deserializarEsquema(JSON.stringify(data.esquema));
        set((s) => ({ esquemas: { ...s.esquemas, [tool]: nodo } }));
        return nodo;
      }
    } catch (err) {
      console.warn(`[workspace] esquema ${tool} vive no disponible, uso estatico:`, err);
    }
    const fb = estatico(tool);
    if (fb) set((s) => ({ esquemas: { ...s.esquemas, [tool]: fb } }));
    return fb;
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

  /* Rehidrata el estado de analisis desde la cache del server (get de toda la
   * cache persistida). [por que] El analisis solo se guarda en el store durante
   * la sesion; sin esto, al recargar la pagina se perdia toda la info aunque el
   * server siguiera cacheandola en disco. Best-effort: si falla, no rompe el
   * arranque. */
  cargarAnalisis: async () => {
    try {
      const { data } = await axios.get<{ total: number; analisis: Record<string, AnalisisSentinel> }>(
        '/api/gate/analisis',
      );
      if (data && typeof data.analisis === 'object') {
        set((s) => ({ analisis: { ...s.analisis, ...data.analisis } }));
      }
    } catch (err) {
      console.warn('[workspace] no se pudo rehidratar el analisis guardado:', err);
    }
  },

  /* Analiza UN proyecto (boton 'Escanea ahora' del detalle/config) y cachea el
   * resultado en el store para que la consola lo agrupe sin volver al server. */
  escanearUno: async (clave, forzar = false) => {
    const { data } = await axios.post<AnalisisSentinel>('/api/gate/analizar', { clave, forzar });
    set((s) => ({ analisis: { ...s.analisis, [clave]: data } }));
    return data;
  },

  /* Barrido serial del workspace (auto-timer y boton 'Escanea todo').
   * [por que] El boton manual manda forzar=true para que sea GENUINO: el
   * server re-escanea git (nuevos commits/HEAD) y re-ejecuta sentinel aunque
   * la frescura no haya cambiado; el auto-timer manda forzar=false y reusa la
   * cache por frescura (branch+HEAD+version) sin spawns innecesarios. */
  escanearTodo: async (forzar = false) => {
    /* [por que] el flag analizando evita barridos encolados (single-flight);
     * el server igual no hace spawn si nada cambio (cache por HEAD/version). */
    if (get().analizando) return;
    set({ analizando: true });
    try {
      const { data } = await axios.post<{
        escaneadoEn: string;
        snapshot?: SnapshotWorkspace;
        proyectos: AnalisisSentinel[];
      }>('/api/gate/analizar-todo', { forzar });
      const analisis: Record<string, AnalisisSentinel> = {};
      for (const a of data.proyectos) analisis[a.clave] = a;
      /* [por que] El server re-escanea git real (snapshotArea(true)) y lo
       * devuelve en `snapshot`: hay que aplicarlo, si no la consola sigue
       * mostrando los contadores de git (sin push/sin commit) del snapshot
       * del arranque aunque el usuario ya haya commiteado/pusheado. */
      set((s) => ({
        snapshot: data.snapshot ?? s.snapshot,
        desdeCache: false,
        analisis: { ...s.analisis, ...analisis },
      }));
    } finally {
      set({ analizando: false });
    }
  },

  /* Rehidrata las vulnerabilidades desde la cache del server (get de toda la
   * cache) para que al recargar no se pierda la info ya auditada. [por que]
   * Igual que cargarAnalisis: best-effort, auditoria de dependencias lenta
   * (5-15 s por lockfile con cambios) y no debe re-ejecutarse al recargar. */
  cargarVulnerabilidades: async () => {
    try {
      const { data } = await axios.get<{
        total: number;
        vulnerabilidades: Record<string, AnalisisVulnerabilidades>;
      }>('/api/gate/vulnerabilidades-cache');
      if (data && typeof data.vulnerabilidades === 'object') {
        set((s) => ({
          vulnerabilidades: { ...s.vulnerabilidades, ...data.vulnerabilidades },
        }));
      }
    } catch (err) {
      console.warn('[workspace] no se pudo rehidratar las vulnerabilidades guardadas:', err);
    }
  },

  /* Audita UN proyecto (boton 'Auditar ahora' del detalle/config) y cachea el
   * resultado en el store para que la consola lo agrupe sin volver al server. */
  auditarUno: async (clave, forzar = false) => {
    const { data } = await axios.post<AnalisisVulnerabilidades>(
      '/api/gate/vulnerabilidades',
      { clave, forzar },
    );
    set((s) => ({
      vulnerabilidades: { ...s.vulnerabilidades, [clave]: data },
    }));
    return data;
  },

  /* Barrido serial del workspace (boton 'Auditar todo'). El server reusa la
   * cache por hash-de-lockfile si nada cambio; el boton manual manda
   * forzar=true para re-auditar de verdad. Single-flight con auditando. */
  auditarTodo: async (forzar = false) => {
    if (get().auditando) return;
    set({ auditando: true });
    try {
      const { data } = await axios.post<{
        escaneadoEn: string;
        snapshot?: SnapshotWorkspace;
        proyectos: AnalisisVulnerabilidades[];
      }>('/api/gate/vulnerabilidades-todo', { forzar });
      const vuls: Record<string, AnalisisVulnerabilidades> = {};
      for (const v of data.proyectos) vuls[v.clave] = v;
      set((s) => ({
        snapshot: data.snapshot ?? s.snapshot,
        desdeCache: false,
        vulnerabilidades: { ...s.vulnerabilidades, ...vuls },
      }));
    } finally {
      set({ auditando: false });
    }
  },

  /* Exime/quita la exencion de gate de glory-sentinel (plan 308A-1 F6). El
   * server valida que la clave sea glory-sentinel; solo persiste la config. */
  cambiarSinGate: async (clave, eximir) => {
    try {
      const { data } = await axios.post<{ ok: boolean; snapshot?: SnapshotWorkspace }>('/api/config/singate', {
        op: eximir ? 'eximir' : 'quitar',
        clave,
      });
      if (data.snapshot) set({ snapshot: data.snapshot, desdeCache: false });
    } catch (err) {
      const detalle = (err as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle;
      throw new Error(detalle ?? 'no se pudo guardar la config');
    }
  },

  /* Persiste automatico+intervalo (switch/input del PanelConfig). */
  configurarScan: async (scan) => {
    const { data } = await axios.post<{ ok: boolean; config: ConfigWorkspace }>('/api/config/scan', scan);
    set((s) => ({
      snapshot: s.snapshot ? { ...s.snapshot, config: data.config } : s.snapshot,
    }));
  },
}));

/* Auto-escaneo periodico (plan A4). [por que] El timer vive en el CLIENTE, asi
 * con la app cerrada hay cero recursos (no hay ningun demonio server). Respeta
 * scan.automatico e intervaloMin; no relanza si ya hay un barrido en curso
 * (single-flight) y se detiene solo (detenerAuto) si la config cambia a apagado
 * o si la sesion carga una config sin automatico. */
let temporizadorAuto: ReturnType<typeof setInterval> | null = null;

function detenerAuto(): void {
  if (temporizadorAuto !== null) {
    clearInterval(temporizadorAuto);
    temporizadorAuto = null;
  }
}

/* Rearma el timer acorde a la config actual; si esta apagado, lo detiene. */
function rearmarAuto(): void {
  detenerAuto();
  const scan = useWorkspaceStore.getState().snapshot?.config?.scan;
  if (!scan?.automatico) return;
  const min = Math.max(1, scan.intervaloMin ?? 30);
  temporizadorAuto = setInterval(() => {
    const st = useWorkspaceStore.getState();
    if (!st.snapshot?.config?.scan?.automatico) {
      detenerAuto();
      return;
    }
    /* [por que] El timer no debe propagar una rechazo del POST (p. ej. server
     * caido) como rejection no manejada cada intervalo; la proxima pasada lo
     * reintenta. El flag analizando se limpia en el finally de escanearTodo. */
    if (!st.analizando) void st.escanearTodo().catch(() => {});
    /* [por que] Vulnerabilidades (308A-4 V2): el mismo intervalo tambien audita
     * dependencias, con single-flight propio (auditando) para no duplicar una
     * corrida solapada, y el server reusa la cache por hash-del-lockfile asi que
     * si ningun lockfile cambio la pasada es barata. Igual que escanearTodo,
     * nunca se propaga una rechazo fuera del intervalo. */
    if (!st.auditando) void st.auditarTodo().catch(() => {});
  }, min * 60_000);
}

/* Rearma cada vez que cambia la config de scan (inicial al cargar y al
 * guardar el switch/intervalo desde PanelConfig). */
useWorkspaceStore.subscribe((s, prev) => {
  if (s.snapshot?.config?.scan !== prev.snapshot?.config?.scan) rearmarAuto();
});

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
