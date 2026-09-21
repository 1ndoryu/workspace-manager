/* Store global del workspace con zustand.
 * [por que] Estado global minimo: snapshot del area + seleccion + filtros.
 * Selectores especificos (no el store completo) en los componentes.
 * Tipos segregados por dominio en workspace/tipos.ts y acciones por grupo en
 * workspace/acciones*.ts: aqui solo se componen en el store. */
import { create } from 'zustand';
import type { Proyecto } from '../shared/types.js';
import type { EstadoWorkspace } from './workspace/tipos.js';
import { REGLAS as REGLAS_ESTATICAS } from '../shared/gate/reglas.js';
import {
  guardarSeleccion,
  guardarUi,
  seleccionInicial,
  uiInicial,
} from './workspace/persistencia.js';
import { crearAccionesCarga } from './workspace/accionesCarga.js';
import { crearAccionesAnalisis } from './workspace/accionesAnalisis.js';
import { crearAccionesVulnerabilidades } from './workspace/accionesVulnerabilidades.js';
import { crearAccionesConfig } from './workspace/accionesConfig.js';

/* Compat: los tipos se importaban desde este modulo (p. ej. NavBar). */
export type {
  AccionesAnalisis,
  AccionesCarga,
  AccionesConfig,
  AccionesUi,
  AccionesVulnerabilidades,
  DatosAnalisis,
  DatosGate,
  DatosSesion,
  DatosUi,
  EstadoWorkspace,
  MenuContextual,
  PanelCentral,
  VisibilidadPaneles,
} from './workspace/tipos.js';

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
  sincronizacion: null,
  errorSincronizacion: null,
  analisis: {},
  analizando: false,
  vulnerabilidades: {},
  auditando: false,
  ...crearAccionesCarga(set, get),
  ...crearAccionesAnalisis(set, get),
  ...crearAccionesVulnerabilidades(set, get),
  ...crearAccionesConfig(set),
  seleccionar: (id) => {
    /* La persistencia vive en workspace/persistencia.ts. */
    guardarSeleccion(id);
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
    /* [por que] El timer no debe propagar un rechazo del POST (p. ej. server
     * caido) como rejection no manejada cada intervalo; la proxima pasada lo
     * reintenta. El flag analizando se limpia en el finally de escanearTodo. */
    if (!st.analizando) void st.escanearTodo().catch(() => {});
    /* [por que] Vulnerabilidades (308A-4 V2): el mismo intervalo tambien audita
     * dependencias, con single-flight propio (auditando) para no duplicar una
     * corrida solapada, y el server reusa la cache por hash-del-lockfile asi que
     * si ningun lockfile cambio la pasada es barata. Igual que escanearTodo,
     * nunca se propaga un rechazo fuera del intervalo. */
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
