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
  /* Cambios locales contados por tipo: staged (indice), unstaged (arbol de
   * trabajo) y untracked. [por que] El plan pide que 'cambios sin commitear'
   * sea un problema visible en la consola y distinga staged/unstaged/untracked. */
  cambios: { staged: number; unstaged: number; untracked: number };
  /* Worktrees registrados por git cuyo directorio o metadata gitdir ya no
   * existe (prunables). [por que] Detectar arboles huerfanos sin borrar nada:
   * el escaner solo reporta; la limpieza requiere autorizacion explicita. */
  worktreesOrfanos: string[];
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

/* Seccion 'scan' de la config del area: analisis real de sentinel por
 * proyecto, a demanda (boton) o automatico cada cierto intervalo. [por que] El
 * plan analisis-sentinel-consola A2: el auto-escaneo es opt-in y apagado por
 * defecto (con la app cerrada no hay timer -> cero recursos); el intervalo
 * minimo lo valida el server por frescura, no se re-analiza sin cambios. */
export interface ConfigScan {
  automatico: boolean;
  intervaloMin: number;
  /* Si se pide, filtra a la severidad < warning al pedir (opcional). */
  pedirSoloProblemas?: boolean;
}

export interface ConfigWorkspace {
  version: number;
  /* Claves (rutas relativas al area) de proyectos ignorados: no aparecen en
   * el snapshot, se listan en la pagina de excepciones. */
  ignorados: string[];
  /* Claves de proyectos pertenecientes al gate que NO llevan gate (plan
   * 308A-1, excepcion explícita). A diferencia de ignorados, el proyecto
   * SIGUE visible en mapa/lista, pero su puerta se fuerza a 'none' y no
   * genera problema "sin gate" en la consola. Solo se registra
   * 'glory-sentinel' (el propio repo del runtime; instalarle gate seria
   * autorreferencial). */
  sinGate?: string[];
  /* Analisis automatico de sentinel por proyecto (ausente => apagado). */
  scan?: ConfigScan;
}

/* Hallazgo real que sentinel analyze detecta (desnormalizado y plano para que
 * la consola no conozca el formato del runtime: aísla cambios de sentinel). */
export interface HallazgoSentinel {
  ruleId: string;
  mensaje: string;
  severidad: 'error' | 'warning' | 'information' | 'hint';
  /* Ruta relativa al workspace si resolvible, si no la absoluta. */
  archivo: string;
  linea: number | null;
  sugerencia?: string;
}

export type SeveridadSentinel = 'error' | 'warning' | 'information' | 'hint';
export type NombreSeveridad = Record<SeveridadSentinel, number>;

/* Resultado del analisis real de sentinel sobre un proyecto. Nunca anida el
 * formato de sentinel (entries[]): va desnormalizado y acotado. */
export interface AnalisisSentinel {
  clave: string;
  version: string;
  fuente: 'runtime' | 'estatico' | null;
  estado: 'ok' | 'conHallazgos' | 'error';
  analizadoEn: string;
  resumen: NombreSeveridad;
  hallazgos: HallazgoSentinel[];
  /* Detalle del error si estado === 'error'. */
  error?: string;
}

/* Conteo por severidad de la auditoria de dependencias. [por que] Separado del
 * resto de la consola igual que el analisis: critical/high/moderate/low son la
 * nube de severidades que npm/pnpm/cargo audit reportan. */
export interface ConteoVulnerabilidades {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

export interface HallazgoVulnerabilidad {
  paquete: string;
  severidad: 'critical' | 'high' | 'moderate' | 'low';
  /* Rango de versiones afectadas (del advisory). */
  rango: string;
  url?: string;
}

/* Resultado de la auditoria de dependencias de un proyecto (plan
 * vulnerabilidades-consola 308A-4). El cliente es 'tonto': pide, el server
 * resuelve el gestor (npm/pnpm/cargo) segun el lockfile y devuelve este shape
 * plano, con fallback 'noAuditable' si el proyecto no tiene lockfile o el CLI
 * de audit no esta disponible (cargo-audit no instalado). */
export interface AnalisisVulnerabilidades {
  clave: string;
  gestor: 'npm' | 'pnpm' | 'cargo' | null;
  lockfile: string;
  estado: 'ok' | 'conHallazgos' | 'noAuditable' | 'error';
  analizadoEn: string;
  resumen: ConteoVulnerabilidades;
  hallazgos: HallazgoVulnerabilidad[];
  /* Detalle cuando estado === 'error' o 'noAuditable'. */
  error?: string;
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
