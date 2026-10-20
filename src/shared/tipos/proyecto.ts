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
  /* Tareas pendientes en la forma del protocolo (D8). */
  pendientes: number;
  /* Planes activos que el roadmap declara. */
  activos: number;
  ids: string[];
  resumen: string;
  /* Lineas del documento, para el tope de 400 (D8). */
  lineas: number;
  /* Lineas con pinta de tarea que no cumplen la forma del protocolo. */
  problemas: number;
  /* Secciones canonicas ausentes. */
  faltantes: string[];
  /* Rutas de plan declaradas en «Planes activos». */
  planes: string[];
}

export interface ResumenAgents {
  tieneAgentsMd: boolean;
  reglas: string[];
  skills: string[];
}

/* Donde corre el servicio de desarrollo del proyecto y en que modo, segun su
 * ficha en config/registro.json. Ausente si el proyecto no tiene ficha. */
export interface Ejecucion {
  donde: 'laptop' | 'vps89';
  modo: 'dev' | 'build' | null;
}

/* URL desde la que se abre el proyecto en un sitio donde corre. [por que] El
 * tooltip del mapa solo ensena la direccion; se deriva de la ficha del registro
 * (dominio, puertos, host publico) en registro.ts, para que no haya dos reglas. */
export interface UrlDestino {
  donde: 'laptop' | 'vps89' | 'produccion';
  url: string;
}

/* Despliegue de produccion vinculado a un sitio de Coolify (VPS 66). */
export interface Despliegue {
  proveedor: 'coolify';
  vps: string;
  sitio: string;
  dominio: string;
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
  /* Vinculos del registro: donde corre el dev y su despliegue en Coolify. */
  ejecucion?: Ejecucion;
  despliegue?: Despliegue;
  /* URLs para abrirlo, una por sitio donde puede correr (dev y/o produccion). */
  urls?: UrlDestino[];
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
