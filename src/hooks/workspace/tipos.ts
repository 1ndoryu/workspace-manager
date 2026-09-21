/* Tipos del store global, segregados por dominio.
 * [por que] El EstadoWorkspace agregado superaba el umbral de
 * large-interface-isp (>10 miembros). Se parte en interfaces de dominio
 * (datos y acciones por grupo) que el store compone por extension; cada una
 * queda en o por debajo del limite. useWorkspace.ts re-exporta estos tipos,
 * asi que los consumidores no cambian. */
import type {
  AnalisisSentinel,
  AnalisisVulnerabilidades,
  ConfigScan,
  SnapshotWorkspace,
} from '../../shared/types.js';
import type { ReglaCatalogo } from '../../shared/gate/reglas.js';
import type { NodoEsquema } from '../../shared/gate/esquema.js';
import type { TipoGate } from '../../shared/gate/proveedores.js';
import type { ReporteSincronizacion } from '../../server/gate/sincronizacion.js';

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

/* Sesion: snapshot del area, seleccion y filtros (8 miembros). */
export interface DatosSesion {
  snapshot: SnapshotWorkspace | null;
  cargando: boolean;
  error: string | null;
  desdeCache: boolean;
  proyectoSeleccionado: string | null;
  vista: 'mapa' | 'lista' | 'agents';
  filtro: 'todos' | 'repos' | 'dirty' | 'conGate';
  buscar: string;
}

/* UI persistente del shell: panel central, paneles visibles, ruta del
 * navegador embebido, menu contextual y proyecto en configuracion (5). */
export interface DatosUi {
  panelCentral: PanelCentral;
  visibles: VisibilidadPaneles;
  navegadorRuta: string | null;
  /* Menu contextual (clic derecho) sobre un proyecto: posicion y clave. */
  menuContextual: MenuContextual | null;
  /* Proyecto que configura la pagina 'config' (se abre desde el menu). */
  proyectoAConfigurar: string | null;
}

/* Catalogo de reglas del gate desde /api/gate/reglas (vivo) con fallback
 * al estatico embebido si el server no lo entrega. [por que] El plan
 * gate-dinamico R1: el cliente es 'tonto', pide el catalogo una vez y lo
 * cachea en el store; el server resuelve el runtime sentinel. */
export interface DatosGate {
  reglasCatalogo: { version: string; fuente: 'runtime' | 'estatica'; reglas: ReglaCatalogo[] };
  /* Esquemas de config por herramienta (sentinel/varsense), servidos por la
   * API /gate/dinamico (E1 gate-dinamico). El cliente deja de importar los
   * ESQUEMA_* estaticos en el bundle; el server resuelve y aqui se cachea. */
  esquemas: Partial<Record<TipoGate, NodoEsquema>>;
  /* Estado de centralizacion del gate (plan 308A-1 F7): reporte de
   * quality-sync (aligned/desync por consumidor). Se cachea en el store y se
   * refresca a demanda (boton 'Verificar' en el panel). */
  sincronizacion: ReporteSincronizacion | null;
  /* Ultimo error al pedir /api/gate/sincronizacion (219A-1): el catch de la
   * accion solo logueaba y la vista quedaba en el hint inicial sin explicar
   * por que no hay datos; con esto VistaGate lo muestra en vez de callar. */
  errorSincronizacion: string | null;
}

/* Caches de analisis: sentinel por proyecto y vulnerabilidades de
 * dependencias, cada una con su flag de single-flight (4 miembros). */
export interface DatosAnalisis {
  /* Analisis real de sentinel por proyecto (plan analisis-sentinel-consola):
   * el server es el dueno de la ejecucion y aqui solo se cachean resultados
   * para que la consola cuente/agrupe sin volver a preguntar. */
  analisis: Record<string, AnalisisSentinel>;
  /* Indica si hay un barrido de analisis en curso (para el auto-timer: nunca
   * lanza un segundo barrido si ya hay uno — single-flight). */
  analizando: boolean;
  /* Vulnerabilidades de dependencias (plan 308A-4 V1): cache por proyecto.
   * El server resuelve gestor/lockfile y aqui solo se guardan resultados. */
  vulnerabilidades: Record<string, AnalisisVulnerabilidades>;
  /* Single-flight del barrido de vulnerabilidades (igual que analizando). */
  auditando: boolean;
}

/* Carga inicial e hidratacion: snapshot, catalogo de reglas y un esquema (3). */
export interface AccionesCarga {
  cargar: (forzar?: boolean) => Promise<void>;
  cargarReglas: () => Promise<void>;
  cargarEsquema: (tool: TipoGate) => Promise<NodoEsquema | undefined>;
}

/* Analisis sentinel: rehidratar cache, escanear uno y barrido serial (3). */
export interface AccionesAnalisis {
  /* Rehidrata el estado de analisis desde la cache persistida del server al
   * arrancar, para que al recargar no se pierda la info ya analizada. */
  cargarAnalisis: () => Promise<void>;
  escanearUno: (clave: string, forzar?: boolean) => Promise<AnalisisSentinel>;
  /* Barrido serial del workspace (auto-timer y boton 'Escanea todo'). */
  escanearTodo: (forzar?: boolean) => Promise<void>;
}

/* Auditoria de dependencias: rehidratar cache, auditar una y barrido (3). */
export interface AccionesVulnerabilidades {
  cargarVulnerabilidades: () => Promise<void>;
  auditarUno: (clave: string, forzar?: boolean) => Promise<AnalisisVulnerabilidades>;
  auditarTodo: (forzar?: boolean) => Promise<void>;
}

/* Config persistente del workspace: ignorar, eximir de gate, scan y sync (4). */
export interface AccionesConfig {
  /* Ignorar / dejar de ignorar un proyecto por su clave y re-escanea. */
  cambiarIgnorado: (clave: string, ignorar: boolean) => Promise<void>;
  /* Eximir / quitar la exencion de gate de glory-sentinel (plan 308A-1 F6). */
  cambiarSinGate: (clave: string, eximir: boolean) => Promise<void>;
  configurarScan: (scan: ConfigScan) => Promise<void>;
  cargarSincronizacion: () => Promise<void>;
}

/* Setters sincronos de sesion y UI (10 miembros, en el limite permitido). */
export interface AccionesUi {
  seleccionar: (id: string | null) => void;
  setFiltro: (f: DatosSesion['filtro']) => void;
  setBuscar: (b: string) => void;
  setPanelCentral: (p: PanelCentral) => void;
  setPanelVisible: (clave: keyof VisibilidadPaneles, valor: boolean) => void;
  irAArchivos: (ruta: string) => void;
  consumirNavegadorRuta: () => void;
  abrirMenuContextual: (m: { x: number; y: number; id: string; clave: string }) => void;
  cerrarMenuContextual: () => void;
  configurarProyecto: (clave: string) => void;
}

/* Estado completo del store, compuesto por extension (0 miembros propios). */
export interface EstadoWorkspace
  extends DatosSesion,
    DatosUi,
    DatosGate,
    DatosAnalisis,
    AccionesCarga,
    AccionesAnalisis,
    AccionesVulnerabilidades,
    AccionesConfig,
    AccionesUi {}
