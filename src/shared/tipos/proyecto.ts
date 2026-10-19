/* Dominio proyecto: identidad estable, estado observable y gate del proyecto.
 * [por que] Es el nucleo que consumen casi todas las vistas; separado para que
 * tocar git, vps o analisis no obligue a releer todo el contrato. */
import type { EstadoGit } from './git.js';

export type TipoProyecto = 'repo' | 'worktree' | 'carpeta' | 'submodulo-padre';

export interface EstadoGate {
  declarado: boolean;
  sentinel: 'config' | 'lock' | 'none';
  varsense: boolean;
  /* Varsense declarado opcional por config del area: el proyecto lleva
   * sentinel pero se exime de varsense (p. ej. Tailwind v4 sin tokens, donde
   * varsense no aporta). La consola no genera "varsense ausente". */
  varsenseOpcional?: boolean;
  /* Sin hojas de estilo ni config de tailwind en el proyecto: varsense no tiene
   * nada que validar y la consola no genera "varsense ausente". */
  sinEstilos?: boolean;
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
  /** Este proyecto es el propio tablero (se decide por ruta, no por nombre). */
  esMando?: boolean;
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
