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

/* Resumen de un commit para el detalle de sincronizacion de la tab repos:
 * hash completo (el cliente recorta), fecha ISO y primera linea. */
export interface CommitResumen {
  hash: string;
  fecha: string;
  mensaje: string;
}

/* Un lado del sync contra el upstream: commits + stat agregado. [por que]
 * El diff --shortstat resume archivos/inserciones/borrados en una linea para
 * la cabecera plegable; la lista de commits muestra que se va a subir/traer. */
export interface LadoSync {
  commits: CommitResumen[];
  archivos: number;
  inserciones: number;
  borrados: number;
}

/* Archivo con cambios sin commitear: ruta tal cual la da el porcelain y
 * estado derivado de las columnas XY (X=indice, Y=arbol de trabajo). */
export interface ArchivoLocal {
  ruta: string;
  estado: 'staged' | 'unstaged' | 'untracked' | 'mixto';
}

/* Archivos con cambios sin commitear + diffs para el lateral de la tab
 * repos (GET /api/repos/archivos?clave=, 299A-4, copiado de glory-harness):
 * entradas = estado XY crudo (2 chars del porcelain) + ruta destino;
 * diffStaged = `diff --cached`, diffUnstaged = `diff` + untracked como
 * `diff --no-index -- /dev/null <ruta>`. Solo lectura. */
export interface EntradaCambio {
  estado: string;
  ruta: string;
}

export interface ArchivosRepo {
  clave: string;
  entradas: EntradaCambio[];
  diffStaged: string;
  diffUnstaged: string;
  truncado: boolean;
}

/* Detalle de sincronizacion de un repo (GET /api/repos/detalle?clave=).
 * salientes = @{upstream}..HEAD (por subir), entrantes = HEAD..@{upstream}
 * (por traer). Cálculo local sin fetch (ver pie en el cliente). */
export interface DetalleRepoSync {
  clave: string;
  sinUpstream: boolean;
  salientes: LadoSync;
  entrantes: LadoSync;
  locales: { archivos: ArchivoLocal[]; truncado: boolean };
}

/* Tab vps (GET /api/vps/*, 299A-5): despliegues Coolify en solo lectura via
 * coolify-manager-rs. El server ejecuta el binario por consulta (execFile sin
 * shell, argv construido solo con comandos de lectura) y aqui solo viajan
 * resumenes parseados: los secretos de settings.json nunca salen del server.
 * Estados: el manager da texto humano en list/health/audit/logs, asi que el
 * parseo es estricto y lo no reconocido es 'desconocido', nunca verde. */
export interface VpsSitio {
  nombre: string;
  dominio: string;
  target: string;
  uuid: string;
  /* Estado real desde `list --detailed` (running/exited/...) o
   * 'sin-asignar' (sin UUID) / 'desconocido' (no parseable). */
  estadoReal: string;
}

export interface VpsAviso {
  nombre: string;
  problema: 'sin-asignar' | 'estado-desconocido' | 'sin-estado-real';
}

export interface VpsSitios {
  sitios: VpsSitio[];
  /* Conciliacion settings <-> real: lo configurado que no cuadra con lo
   * real. Limite honesto: lo real-fuera-de-settings no es visible desde
   * `list` (solo lee settings), asi que no se inventa. */
  avisos: VpsAviso[];
  aviso: string | null;
}

/* Pieza del detalle/de recursos: degradacion parcial (una pieza puede fallar
 * y el resto sigue visible). datos = JSON parseado o texto recortado. */
export interface VpsPieza {
  ok: boolean;
  datos: unknown;
  error: string | null;
}

export interface VpsDetalle {
  sitio: string;
  piezas: Record<string, VpsPieza>;
}

export interface VpsRecursos {
  piezas: Record<string, VpsPieza>;
}

/* Estado del puente + refresco configurable (GET /api/vps/config):
 * refreshMs 0 = manual con boton (defecto). */
export interface VpsConfig {
  refreshMs: number;
  binario: { ruta: string; version: string | null; ok: boolean };
}

/* Snapshot del agente glory-pulse (GET /api/vps/agente, 299A-12 F2): una
 * sola conexión contra la VPS en vez de las 7 piezas legacy en serie. El
 * token Bearer nunca sale del server: aquí viajan solo resúmenes. `frescura`
 * lleva reloj del backend (edad del snapshot servido). */
export interface VpsAgenteContenedor {
  id: string;
  nombre: string;
  estado: string;
  imagen: string;
  cpuPct: number;
  memMiB: number;
  memLimiteMiB: number | null;
  redRxBytes: number;
  redTxBytes: number;
  blkReadBytes: number;
  blkWriteBytes: number;
  sitioUuid: string | null;
  dominio: string | null;
}

export interface VpsAgenteSnapshot {
  schema: 1;
  hostId: string;
  ts: number;
  contenedores: VpsAgenteContenedor[];
  truncado: boolean;
  totalContenedores: number;
  frescura: { fuente: 'agente'; edadMs: number };
}

export interface VpsAgenteRespuesta {
  disponible: boolean;
  snapshot: VpsAgenteSnapshot | null;
  error: string | null;
}

export interface EstadoGate {
  declarado: boolean;
  sentinel: 'config' | 'lock' | 'none';
  varsense: boolean;
  /* Varsense declarado opcional por config del area: el proyecto lleva
   * sentinel pero se exime de varsense (p. ej. Tailwind v4 sin tokens, donde
   * varsense no aporta). La consola no genera "varsense ausente". */
  varsenseOpcional?: boolean;
  doctor: string | null;
  gateDisponible: boolean;
  puerta: 'sentinel' | 'cargo' | 'none';
  /* Exencion explicita del gate por config del area (sinGate): el proyecto
   * sigue visible pero la consola no genera "sin gate". [por que] Sin este
   * flag, un exento es indistinguible de un proyecto sin gate (ambos tienen
   * declarado:false + puerta:'none') y la consola reportaba un falso
   * positivo. */
  exentoGate?: boolean;
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

/* Identidad estable de un proyecto (quien es y donde esta). Subinterface de
 * Proyecto: ISP cohesiva sin cambiar el contrato (Proyecto la extiende). */
export interface IdentidadProyecto {
  id: string;
  /* Clave unica: ruta relativa al area, separador '/'. [por que] El id (nombre
   * de carpeta) es ambiguo (p. ej. '01' puede ser 3D/01 u otro); para ignorar
   * y para el menu contextual se usa la ruta relativa, que identifica sin
   * colisionar. */
  clave: string;
  ruta: string;
  esGit: boolean;
  tipo: TipoProyecto;
  padre?: string;
}

/* Estado observable de un proyecto (gate, git, resumenes). Subinterface de
 * Proyecto: lo que cambia entre escaneos, separado de la identidad. */
export interface EstadoProyecto {
  git?: EstadoGit;
  gate?: EstadoGate;
  /* Problemas de la config del gate (sentinel.config.json / varsense.config.json)
   * detectados por esquema en el escaneo: los reporta la consola. [por que] La
   * consola se alimenta del snapshot; diagnosticar aqui evita estado fragil del
   * cliente y que el editor sea el unico que vea faltantes/typos/tipos mal. */
  gateProblemas?: ProblemaGate[];
  roadmap?: ResumenRoadmap;
  agents?: ResumenAgents;
}

export interface Proyecto extends IdentidadProyecto, EstadoProyecto {}

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
  /* Claves de proyectos con sentinel declarado pero exentos de varsense: la
   * consola no genera "varsense ausente" y el analisis no exige varsense.
   * Opt-in por excepcion explicita en data/workspace.config.json (v4). */
  varsenseOpcional?: string[];
  /* Analisis automatico de sentinel por proyecto (ausente => apagado). */
  scan?: ConfigScan;
}

/* Hallazgo real que sentinel analyze / varsense detectan (desnormalizado y
 * plano para que la consola no conozca el formato del runtime: aísla cambios
 * de sentinel/varsense). `fuente` distingue qué herramienta emitió el
 * hallazgo (fase G: el analisis fusiona ambos reportes). */
export interface HallazgoSentinel {
  ruleId: string;
  mensaje: string;
  severidad: 'error' | 'warning' | 'information' | 'hint';
  /* Ruta relativa al workspace si resolvible, si no la absoluta. */
  archivo: string;
  linea: number | null;
  sugerencia?: string;
  /* 'sentinel' | 'varsense'. Ausente => sentinel (retrocompat cache vieja). */
  fuente?: 'sentinel' | 'varsense';
}

export type SeveridadSentinel = 'error' | 'warning' | 'information' | 'hint';
export type NombreSeveridad = Record<SeveridadSentinel, number>;

/* Cabecera de un analisis: que proyecto, con que runtime y en que estado quedo.
 * Subinterface de AnalisisSentinel (ISP cohesiva, contrato intacto). */
export interface CabeceraAnalisis {
  clave: string;
  version: string;
  /* Commit corto del binario que produjo el análisis: el declarado en el
   * `quality-tools.json` del proyecto cuando fija su propio `provisionPath`
   * (039A-4). Ausente en análisis con el checkout compartido/instalado y en
   * caché persistida vieja: el panel solo lo muestra si viene. */
  commitCli?: string;
  fuente: 'runtime' | 'estatico' | null;
  estado: 'ok' | 'conHallazgos' | 'error';
  analizadoEn: string;
  /* Detalle del error si estado === 'error'. */
  error?: string;
}

/* Estado de VarSense fusionado al analisis (fase G): version del runtime
 * y conteos de sus hallazgos (ya incluidos en `resumen`/`hallazgos`, con
 * `fuente: 'varsense'`). Ausente => varsense no declarado o no corrido. */
export interface DetalleVarsense {
  version: string;
  resumen: NombreSeveridad;
}

/* Cuerpo de un analisis: conteos, hallazgos y detalle VarSense. */
export interface CuerpoAnalisis {
  resumen: NombreSeveridad;
  hallazgos: HallazgoSentinel[];
  varsense?: DetalleVarsense;
}

/* Resultado del analisis real de sentinel sobre un proyecto. Nunca anida el
 * formato de sentinel (entries[]): va desnormalizado y plano. Los hallazgos
 * van COMPLETOS (sin cap): el render del cliente es acotado, pero los conteos
 * del agregado deben coincidir con el CLI directo (308A-6J11). */
export interface AnalisisSentinel extends CabeceraAnalisis, CuerpoAnalisis {}

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

/* Cabecera del snapshot: cuando se escaneo y cual es la raiz del area. */
export interface CabeceraSnapshot {
  escaneadoEn: string;
  /* Raiz del area: permite al cliente convertir rutas absolutas de proyectos
   * en rutas relativas para el navegador de archivos. */
  raiz: string;
}

/* Agregado numerico del snapshot (conteos por tipo/estado). */
export interface ResumenSnapshot {
  total: number;
  repos: number;
  worktrees: number;
  carpetas: number;
  dirty: number;
  conGate: number;
  pendientesRoadmap: number;
}

/* Cuerpo del snapshot: proyectos, agentes, config y resumen. */
export interface CuerpoSnapshot {
  proyectos: Proyecto[];
  agentes: AgentesInfo;
  /* Config persistente del area (ignorados, overrides por proyecto).
   * [por que] El escaner la lee para filtrar y el cliente la muestra en la
   * pagina de excepciones/configuracion. */
  config: ConfigWorkspace;
  resumen: ResumenSnapshot;
}

export interface SnapshotWorkspace extends CabeceraSnapshot, CuerpoSnapshot {}

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
