/* Tipos y constantes de la política guard (F11.4). Sin E/S: los comparten la
 * validación, el plan de edición y la lectura/escritura. */
import type { BloqueDiff } from '../../escritura.js';

export const MODOS_GUARD = ['enforce', 'observe', 'pass-through'] as const;
export type ModoGuard = (typeof MODOS_GUARD)[number];

export const LISTAS_GUARD = ['npmScripts', 'npxTools', 'cargoSubcommands', 'tools'] as const;
export type ListaGuard = (typeof LISTAS_GUARD)[number];
export type Listas = Record<ListaGuard, string[]>;

/* Git, python y pip no tienen shim (D8 a): listarlos no intercepta nada. */
export const SIN_SHIM = ['git', 'python', 'pip'] as const;

/* Error de entrada del usuario: las rutas lo convierten en 422, no en 500. */
export class ErrorValidacion extends Error {}

export interface Plantilla {
  schemaVersion: 1;
  descripcion?: string;
  quitarDeTools: string[];
  plantillas: Record<string, Partial<Listas>>;
  stackDeProyecto: Record<string, string[]>;
}

export interface CambioPolitica {
  modo?: ModoGuard;
  listas?: Partial<Listas>;
  /* Aplica la plantilla de los stacks del proyecto encima de las listas. */
  aplicarPlantilla?: boolean;
}

export type LecturaPolitica =
  | { estado: 'ausente' }
  | { estado: 'invalida'; motivo: string; hash: string | null }
  | { estado: 'ok'; modo: ModoGuard; listas: Listas; contenido: string; hash: string };

export type ResultadoValidacion =
  | { ok: true; modo: ModoGuard; listas: Listas }
  | { ok: false; motivo: string };

export interface PlanEdicion {
  nuevo: string;
  cambia: boolean;
  diff: BloqueDiff | null;
}

export interface EntradaEdicion {
  clave: string;
  hashPrevio: string;
  cambio: CambioPolitica;
}

export type ResultadoEdicion =
  | { estado: 'ok'; cambia: boolean; diff: BloqueDiff | null; hash: string; plan: PlanEdicion; lectura: Extract<LecturaPolitica, { estado: 'ok' }> }
  | { estado: 'conflicto'; motivo: string }
  | { estado: 'error'; motivo: string };

export interface EdicionLote {
  clave: string;
  raiz: string;
  hashPrevio: string;
  cambio: CambioPolitica;
  contexto?: { plantilla: Plantilla; stacks: string[] };
}

export interface ResultadoLote {
  ok: boolean;
  resultados: Array<{ clave: string; resultado: ResultadoEdicion }>;
  /* Solo si una escritura falló a mitad: qué se revirtió y qué no pudo revertirse. */
  revertidas?: string[];
  sinRevertir?: string[];
  error?: string;
}
