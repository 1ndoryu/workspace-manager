/* Contrato de /api/guardian/* para la pestaña Guardián (10AA-2 F11.4).
 * [por que] Espejo de los tipos del servidor (rutasGuardian.ts y guardian/): el
 * front no importa código de server/ porque arrastra módulos de Node. Si el
 * servidor cambia una forma, este archivo se cambia en el mismo bloque. */

export type ModoGuard = 'enforce' | 'observe' | 'pass-through';
export type ModoTope = 'observe' | 'enforce';
export type ListaGuard = 'npmScripts' | 'npxTools' | 'cargoSubcommands' | 'tools';
export type Listas = Record<ListaGuard, string[]>;

export const LISTAS: ListaGuard[] = ['npmScripts', 'npxTools', 'cargoSubcommands', 'tools'];
export const CLASES_TOPE = ['cargo-check', 'cargo-clippy', 'cargo-test', 'tsc-noemit'] as const;
export type ClaseTope = (typeof CLASES_TOPE)[number];

export interface BloqueDiff {
  desde: number;
  quitar: string[];
  poner: string[];
}

/* Estado de la política de un proyecto (listas y modo). */
export type EstadoListas =
  | { estado: 'ok'; listas: Listas; modo: ModoGuard }
  | { estado: 'ausente' }
  | { estado: 'invalida'; motivo: string };

export type DiferenciasPlantilla =
  | { estado: 'ok'; stacks: string[]; faltan: string[]; reaparecen: string[] }
  | { estado: 'sin-plantilla' }
  | { estado: 'sin-politica' };

export interface ClaseGuard {
  iniciados: number;
  bloqueados: number;
  ultimoTs: string | null;
  usado: number;
  limite: number;
  extra: number;
  modo: ModoTope;
}

export interface TareaGuard {
  tarea: string;
  etapa: string;
  clases: Record<string, ClaseGuard>;
  totalBloqueados: number;
  ultimoTs: string | null;
}

export interface PoliticaGuard {
  config: 'ok' | 'ausente' | 'ilegible';
  modo: ModoTope;
  limites: Record<string, number>;
  limitesExtra: string[];
}

export interface OverrideGuard {
  existe: boolean;
  extra: number;
  primeraLinea: string;
}

/* Proyecto con Guardián (puerta sentinel). `hashes` solo viene en GET /estado. */
export interface ProyectoGuardian {
  clave: string;
  elegible: true;
  ruta: string;
  politica: PoliticaGuard;
  override: OverrideGuard;
  tareas: TareaGuard[];
  totalBloqueados: number;
  listas: EstadoListas;
}

export interface ProyectoSinGuardian {
  clave: string;
  elegible: false;
}

export interface EstadoProyecto extends ProyectoGuardian {
  hashes: { config: string | null; extra: string | null };
}

export interface ProyectoArea extends ProyectoGuardian {
  diferencias: DiferenciasPlantilla;
}

export interface EstadoArea {
  total: number;
  sinShim: string[];
  proyectos: Array<ProyectoArea | ProyectoSinGuardian>;
}

export interface PlantillaDatos {
  schemaVersion: 1;
  descripcion?: string;
  quitarDeTools: string[];
  plantillas: Record<string, Partial<Listas>>;
  stackDeProyecto: Record<string, string[]>;
}

export type LecturaPlantilla =
  | { estado: 'ausente' }
  | { estado: 'invalida'; motivo: string; hash: string | null }
  | { estado: 'ok'; plantilla: PlantillaDatos; contenido: string; hash: string };

/* Cambio de política. Las listas enviadas reemplazan la lista entera. */
export interface CambioPolitica {
  modo?: ModoGuard;
  listas?: Partial<Listas>;
  aplicarPlantilla?: boolean;
}

/* Respuesta de una edición de política o plantilla (una sola entrada). */
export type RespuestaEdicion =
  | { estado: 'ok'; cambia: boolean; diff: BloqueDiff | null; hashNuevo: string; escrito: boolean }
  | { estado: 'conflicto' | 'error'; motivo: string };

export interface EntradaResultadoLote {
  clave: string;
  estado: 'ok' | 'conflicto' | 'error';
  cambia?: boolean;
  diff?: BloqueDiff | null;
  hashNuevo?: string;
  motivo?: string;
}

export type RespuestaLote =
  | { estado: 'ok'; escrito: boolean; resultados: EntradaResultadoLote[] }
  | { estado: 'conflicto' | 'error'; resultados: EntradaResultadoLote[] }
  | { estado: 'error'; error: string; revertidas: string[]; sinRevertir: string[] };

export interface CambioTopes {
  modo?: ModoTope;
  limites?: Partial<Record<ClaseTope, number | null>>;
  extraTotal?: number;
  motivo?: string;
}

export interface HashesTopes {
  config: string;
  extra: string | null;
}

/* Vista previa (sin confirmar): `escrito` false y `hashesNuevos`. Confirmada:
 * `escrito` true y `hashes`. Ninguna de las dos trae ambos. */
export type RespuestaTopes =
  | {
      estado: 'ok';
      escrito: boolean;
      cambia: boolean;
      diffConfig: BloqueDiff | null;
      diffExtra: BloqueDiff | null;
      hashes?: HashesTopes;
      hashesNuevos?: HashesTopes;
    }
  | { estado: 'conflicto' | 'error'; motivo: string; configRevertida?: boolean };

export type DecisionProbada = {
  blocked: boolean;
  mode?: string;
  action?: string;
  observed?: boolean | string;
  reason?: string;
  category?: string | null;
  policyStatus?: string;
  alternativa?: string;
};

export type ResultadoProbar =
  | { estado: 'ok'; codigo: number; decision: DecisionProbada }
  | { estado: 'error'; motivo: string };

export type DecisionRegistro = 'bloqueado' | 'observado' | 'paso';

export interface EntradaDiario {
  fecha: string;
  proyecto: string;
  comando: string;
  decision: DecisionRegistro;
  motivo: string;
}

export interface EntradaAuditoria {
  at: string;
  event: string;
  leaseId?: string | null;
  pid?: number;
  projectRoot?: string;
  command?: string;
  valid?: boolean;
  reason?: string;
  count?: number;
}

export interface LeaseActiva {
  id: string;
  pid: number;
  projectRoot: string;
  command: string;
  taskId: string | null;
  issuedAt: string;
  expiresAt: string;
}

export interface SeccionLectura<T> {
  disponible: boolean;
  entradas: T[];
  total: number;
  corruptas: number;
}

export interface ActividadGuardian {
  origen: { diario: string; auditoria: string };
  diario: SeccionLectura<EntradaDiario>;
  auditoria: SeccionLectura<EntradaAuditoria>;
  leases: { activos: LeaseActiva[]; expirados: number };
  limite: number;
}

export interface FiltrosActividadUi {
  proyecto?: string;
  comando?: string;
  decision?: DecisionRegistro;
  limite?: number;
}

export interface ResultadoMantenimiento {
  estado: 'ok' | 'error';
  modo: 'simulacion' | 'aplicado';
  codigo: number | null;
  motivo?: string;
  salida: string;
}
