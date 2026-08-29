/* Tipos compartidos entre server y cliente del workspace-manager.
 * [por que] Contrato unico para que el escaner (server) y las vistas (client)
 * no deriven en tipos duplicados que se desincronicen. */

export type TipoProyecto = 'repo' | 'worktree' | 'carpeta' | 'submodulo-padre';

export interface EstadoGit {
  rama: string;
  remoto: string | null;
  ramaPrimaria: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  submodulos: string[];
  ultimoCommit: {
    hash: string;
    fecha: string;
    mensaje: string;
  } | null;
}

export interface EstadoGate {
  declarado: boolean;
  sentinel: 'config' | 'lock' | 'none';
  varsense: boolean;
  doctor: string | null;
  gateDisponible: boolean;
  puerta: 'sentinel' | 'cargo' | 'none';
}

export interface ResumenRoadmap {
  pendientes: number;
  activos: number;
  ids: string[];
  resumen: string;
}

export interface ResumenAgents {
  tieneAgentsMd: boolean;
  reglas: string[];
  skills: string[];
}

export interface Proyecto {
  id: string;
  /* Clave unica: ruta relativa al area, separador '/'. [por que] El id (nombre
   * de carpeta) es ambiguo (p. ej. '01' puede ser 3D/01 u otro); para ignorar
   * y para el menu contextual se usa la ruta relativa, que identifica sin
   * colisionar. */
  clave: string;
  ruta: string;
  esGit: boolean;
  tipo: TipoProyecto;
  git?: EstadoGit;
  gate?: EstadoGate;
  /* Problemas de la config del gate (sentinel.config.json / varsense.config.json)
   * detectados por esquema en el escaneo: los reporta la consola. [por que] La
   * consola se alimenta del snapshot; diagnosticar aqui evita estado fragil del
   * cliente y que el editor sea el unico que vea faltantes/typos/tipos mal. */
  gateProblemas?: ProblemaGate[];
  roadmap?: ResumenRoadmap;
  agents?: ResumenAgents;
  padre?: string;
}

export interface ProblemaGate {
  archivo: string;
  /* Ruta de la opcion, p.ej. 'project › primaryBranch'. */
  ruta: string;
  severidad: 'error' | 'advertencia';
  mensaje: string;
}

export interface ConfigWorkspace {
  version: number;
  /* Claves (rutas relativas al area) de proyectos ignorados: no aparecen en
   * el snapshot, se listan en la pagina de excepciones. */
  ignorados: string[];
}

export interface SkillGlobal {
  nombre: string;
  descripcion: string;
  ruta: string;
}

export interface AgentesInfo {
  global: {
    tieneAgentsMd: boolean;
    ruta: string | null;
    reglas: string[];
  };
  skills: SkillGlobal[];
}

export interface SnapshotWorkspace {
  escaneadoEn: string;
  /* Raiz del area: permite al cliente convertir rutas absolutas de proyectos
   * en rutas relativas para el navegador de archivos. */
  raiz: string;
  proyectos: Proyecto[];
  agentes: AgentesInfo;
  /* Config persistente del area (ignorados, overrides por proyecto).
   * [por que] El escaner la lee para filtrar y el cliente la muestra en la
   * pagina de excepciones/configuracion. */
  config: ConfigWorkspace;
  resumen: {
    total: number;
    repos: number;
    worktrees: number;
    carpetas: number;
    dirty: number;
    conGate: number;
    pendientesRoadmap: number;
  };
}

/* Entrada del navegador de archivos: carpeta o archivo dentro del area. */
export interface EntradaArchivo {
  nombre: string;
  ruta: string;
  tipo: 'carpeta' | 'archivo';
  tamano: number | null;
}

export interface ListadoDirectorio {
  ruta: string;
  padre: string;
  entradas: EntradaArchivo[];
}
