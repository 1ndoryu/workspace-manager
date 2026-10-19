/* Tipos de las comprobaciones de salud (10AA-2 F8). Las comprobaciones son funciones
 * puras sobre datos ya leídos; solo `recoger.ts` toca disco, Git y variables.
 * [por que] Separar lectura y juicio permite probar cada comprobación con datos
 * construidos a mano (positivo y negativo), sin fixtures de disco. */
import type { Hallazgo } from '../../shared/salud/salud.js';
import type { Listas, ModoGuard } from '../guardian/configuracion/politica.js';

export interface Comprobacion<D> {
  id: string;
  /* Motivo para omitir la comprobación, o null para ejecutarla. */
  omitirSi?: (datos: D) => string | null;
  evaluar: (datos: D) => Hallazgo[];
}

/* [por que] Estado del Guardián del proyecto, ya validado por politica.ts. */
export type EstadoGuard =
  | { estado: 'ausente' }
  | { estado: 'invalida'; motivo: string }
  | { estado: 'ok'; modo: ModoGuard; listas: Listas; faltanPlantilla: string[] };

export interface RamaSuelta {
  nombre: string;
  remota: boolean;
  /* Fecha del último commit de la rama, en ms desde la época. */
  ultimoCommitMs: number;
}

export interface PlanActivo {
  archivo: string;
  modificadoMs: number;
  /* Casillas `- [ ]` sin marcar. [por que] Un plan con trabajo abierto está activo, aunque
   * lleve días sin tocarse: la alarma por antigüedad solo vale si ya no queda nada abierto. */
  abiertas: number;
}

export interface DatosProyecto {
  clave: string;
  ahora: number;
  /* Gate de Sentinel: sin él no hay Guardián ni versión de Sentinel que comparar. */
  esElegible: boolean;
  /* Cargo.toml presente. */
  esRust: boolean;
  /* Carpetas de compilación dentro del árbol del proyecto, p. ej. ['target']. */
  compilacionEnArbol: string[];
  /* target-dir de .cargo/config.toml; null si no está declarado. */
  targetDir: string | null;
  /* Otros proyectos que declaran el mismo target-dir. */
  targetDirCompartidoCon: string[];
  /* Ficheros del proyecto con CARGO_INCREMENTAL a 0. */
  incrementalDesactivadoEn: string[];
  /* Sección [profile.dev] presente en Cargo.toml. */
  tieneProfileDev: boolean;
  /* Versión de Sentinel en sentinel.lock.json; null si no hay lock. */
  sentinelLock: string | null;
  /* Versión de Sentinel fijada en quality-tools.json; null si no hay pin. */
  sentinelPin: string | null;
  guard: EstadoGuard;
  /* Ramas locales y remotas no integradas en main. */
  ramas: RamaSuelta[];
  /* AGENTS.md / CLAUDE.md en la raíz del proyecto. */
  instruccionesProhibidas: string[];
  planesActivos: PlanActivo[];
  /* Rutas de .md citadas en roadmap.md que no existen. */
  enlacesRotos: string[];
  /* Rango declarado de Vite y TypeScript en frontend/package.json; null si no hay frontend. */
  toolchainFrontend: { vite: string | null; typescript: string | null } | null;
}

export interface DatosArea {
  ahora: number;
  /* Carpetas del área con .git, por id. */
  carpetasGit: string[];
  /* Ids declarados en registro.json: proyectos y noAplica. */
  registradas: string[];
  /* Plataforma del proceso: las comprobaciones de runtime local solo aplican a Windows. */
  plataforma: NodeJS.Platform;
  /* Espacio libre de la unidad del área, en GB; null si no se pudo medir. */
  discoLibreGb: number | null;
  /* Raíz de temporales (C:/tmp en Windows, ~/tmp en Linux, o WM_TMP). */
  rutaTemporales: string;
  /* Tamaño de la raíz de temporales; parcial si la medición se cortó por tiempo. */
  tmp: { bytes: number; parcial: boolean } | null;
  /* CARGO_INCREMENTAL del entorno de usuario, o null si no está definida. */
  incrementalUsuario: string | null;
  /* Versión de Sentinel fijada en quality-tools.json del área. */
  sentinelPin: string | null;
  /* Versión instalada del runtime global; null si no se encuentra. */
  sentinelRuntime: string | null;
  /* Tamaño de AGENTS.md en bytes; null si no existe. */
  agentsBytes: number | null;
  /* Títulos H2 de AGENTS.md y de ~/.claude/CLAUDE.md. */
  titulosAgents: string[];
  titulosClaudeMd: string[];
  /* Subcomandos de scripts/dev/dev.mjs (AYUDA); [] si no se pudo leer. */
  subcomandosArranque: string[];
  /* SKILL.md de workspace-manager en ~/.agents/skills; null si no existe. */
  skillArranque: string | null;
  /* Skills de ~/.config/opencode/skills que también existen en ~/.agents/skills. */
  copiasSkill: { nombre: string; coincide: boolean }[];
}
