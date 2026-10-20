/* Parseo puro de la actividad del Guardián: convierte las líneas del diario y de la
 * auditoría en entradas acotadas, y valida y compara los filtros. Sin E/S: la cola
 * y los leases se leen en actividad-io.ts. Las líneas corruptas se cuentan, no lanzan. */
import { ErrorValidacion } from '../../configuracion/politica.js';
import {
  DECISIONES_REGISTRO,
  EVENTOS_AUDITORIA,
  LIMITE_ACTIVIDAD_MAX,
  MAX_LONGITUD_FILTRO,
  MAX_LONGITUD_TEXTO,
  type DecisionRegistro,
  type EntradaAuditoria,
  type EntradaDiario,
  type EventoAuditoria,
  type FiltrosActividad,
} from './actividad-tipos.js';

export function parseObjeto(linea: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(linea) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function esDecision(v: unknown): v is DecisionRegistro {
  return typeof v === 'string' && (DECISIONES_REGISTRO as readonly string[]).includes(v);
}

function esEvento(v: unknown): v is EventoAuditoria {
  return typeof v === 'string' && (EVENTOS_AUDITORIA as readonly string[]).includes(v);
}

export function acotar(valor: string): string {
  return valor.slice(0, MAX_LONGITUD_TEXTO);
}

export function leerLineasDiario(lineas: string[]): { entradas: EntradaDiario[]; corruptas: number } {
  const entradas: EntradaDiario[] = [];
  let corruptas = 0;
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    const r = parseObjeto(linea);
    if (!r || typeof r.fecha !== 'string' || typeof r.proyecto !== 'string' || typeof r.comando !== 'string' || !esDecision(r.decision)) {
      corruptas += 1;
      continue;
    }
    entradas.push({
      fecha: acotar(r.fecha),
      proyecto: r.proyecto.slice(0, MAX_LONGITUD_FILTRO),
      comando: acotar(r.comando),
      decision: r.decision,
      motivo: typeof r.motivo === 'string' ? acotar(r.motivo) : '',
    });
  }
  return { entradas, corruptas };
}

/* Copia campo a campo: nunca se reenvía la línea de auditoría tal cual. */
function entradaAuditoria(r: Record<string, unknown>): EntradaAuditoria {
  const e: EntradaAuditoria = { at: acotar(r.at as string), event: r.event as EventoAuditoria };
  if (typeof r.leaseId === 'string' || r.leaseId === null) e.leaseId = r.leaseId;
  if (typeof r.pid === 'number') e.pid = r.pid;
  if (typeof r.projectRoot === 'string') e.projectRoot = r.projectRoot.slice(0, MAX_LONGITUD_FILTRO);
  if (typeof r.command === 'string') e.command = acotar(r.command);
  if (typeof r.valid === 'boolean') e.valid = r.valid;
  if (typeof r.reason === 'string') e.reason = acotar(r.reason);
  if (typeof r.count === 'number') e.count = r.count;
  return e;
}

export function leerLineasAuditoria(lineas: string[]): { entradas: EntradaAuditoria[]; corruptas: number } {
  const entradas: EntradaAuditoria[] = [];
  let corruptas = 0;
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    const r = parseObjeto(linea);
    if (!r || typeof r.at !== 'string' || !esEvento(r.event)) {
      corruptas += 1;
      continue;
    }
    entradas.push(entradaAuditoria(r));
  }
  return { entradas, corruptas };
}

function normalizarRuta(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
}

export function coincideComando(comando: string | undefined, filtro: string | undefined): boolean {
  return !filtro || (comando ?? '').toLowerCase().includes(filtro.toLowerCase());
}

export function coincideProyecto(proyecto: string | undefined, filtro: string | undefined): boolean {
  return !filtro || (proyecto !== undefined && normalizarRuta(proyecto) === normalizarRuta(filtro));
}

export function validarFiltros(f: FiltrosActividad): void {
  for (const valor of [f.proyecto, f.comando]) {
    if (valor !== undefined && (typeof valor !== 'string' || valor.length > MAX_LONGITUD_FILTRO || valor.includes('\0'))) {
      throw new ErrorValidacion('filtro de proyecto o comando no válido');
    }
  }
  if (f.decision !== undefined && !esDecision(f.decision)) {
    throw new ErrorValidacion(`decision debe ser ${DECISIONES_REGISTRO.join(', ')}`);
  }
  if (f.limite !== undefined && (!Number.isInteger(f.limite) || f.limite < 1 || f.limite > LIMITE_ACTIVIDAD_MAX)) {
    throw new ErrorValidacion(`limite debe ser un entero entre 1 y ${LIMITE_ACTIVIDAD_MAX}`);
  }
}
