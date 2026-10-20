/* Tipos y constantes de la actividad del Guardián. Sin E/S: los comparten el parseo,
 * la lectura en disco y la fachada actividad.ts. */
export const DECISIONES_REGISTRO = ['bloqueado', 'observado', 'paso'] as const;
export type DecisionRegistro = (typeof DECISIONES_REGISTRO)[number];
export const EVENTOS_AUDITORIA = ['issue', 'verify', 'revoke', 'prune'] as const;
export type EventoAuditoria = (typeof EVENTOS_AUDITORIA)[number];

export const LIMITE_ACTIVIDAD_DEFECTO = 100;
export const LIMITE_ACTIVIDAD_MAX = 500;
export const MAX_LONGITUD_FILTRO = 512;
export const MAX_LONGITUD_TEXTO = 200;

export interface EntradaDiario {
  fecha: string;
  proyecto: string;
  comando: string;
  decision: DecisionRegistro;
  motivo: string;
}

export interface EntradaAuditoria {
  at: string;
  event: EventoAuditoria;
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

export interface FiltrosActividad {
  proyecto?: string;
  comando?: string;
  decision?: DecisionRegistro;
  limite?: number;
}

export interface OpcionesActividad {
  logDir?: string;
  guardRoot?: string;
  ahora?: number;
  env?: NodeJS.ProcessEnv;
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
