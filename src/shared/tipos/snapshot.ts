/* Dominio snapshot: forma del snapshot que sirve el escaner (proyectos, agentes,
 * config y resumen). [por que] Agrupa los tipos que componen la respuesta. */
import type { ConfigWorkspace } from './config.js';
import type { Proyecto } from './proyecto.js';

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
