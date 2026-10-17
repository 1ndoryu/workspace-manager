/* Actividad del Guardián (10AA-2 F11.4, sección «Actividad»): lee el diario de
 * decisiones de Sentinel (F11.2) y la auditoría de leases SIN escribir nada.
 * [por que] Ambos ficheros los escribe el guard fuera de los proyectos; la
 * pestaña solo los presenta. audit.ndjson no rota, así que se lee solo su cola
 * acotada; el diario se lee entero porque rota a 1 MiB. Las líneas corruptas se
 * cuentan y no rompen la lectura. Las rutas por defecto espejan guardLogDir y
 * resolveGuardRoot de glory-sentinel: si cambian allí, cambian aquí. Los leases
 * se muestran sin la firma. */
import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ErrorValidacion } from '../configuracion/politica.js';
import { raizTemporales } from '../../plataforma/temporales.js';

export const DECISIONES_REGISTRO = ['bloqueado', 'observado', 'paso'] as const;
export type DecisionRegistro = (typeof DECISIONES_REGISTRO)[number];
const EVENTOS_AUDITORIA = ['issue', 'verify', 'revoke', 'prune'] as const;
export type EventoAuditoria = (typeof EVENTOS_AUDITORIA)[number];

export const LIMITE_ACTIVIDAD_DEFECTO = 100;
export const LIMITE_ACTIVIDAD_MAX = 500;
/* [por que] Cada fichero del diario se capa a 1 MiB por rotación; audit.ndjson no
 * rota, así que su cola se acota para que una auditoría enorme no bloquee la página. */
const BYTES_DIARIO = 1024 * 1024;
const BYTES_AUDITORIA = 512 * 1024;
const BYTES_LEASE = 64 * 1024;
const MAX_LEASES = 200;
const MAX_LONGITUD_FILTRO = 512;
const MAX_LONGITUD_TEXTO = 200;

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

/* Espejo de guardLogDir (glory-sentinel/src/core/guardLog.ts). */
export function guardLogDirPorDefecto(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GLORY_GUARD_LOG_DIR) return env.GLORY_GUARD_LOG_DIR;
  /* [por que] En Windows la raiz sale de raizTemporales() (su unico dueno, con
   * el override WM_TMP) en vez de repetir el literal. En Linux se mantiene
   * os.tmpdir() a proposito: es lo que resuelve glory-sentinel y esta funcion
   * es su espejo. */
  const base = process.platform === 'win32' ? raizTemporales(env) : os.tmpdir();
  return path.join(base, 'glory-quality-guard');
}

/* Espejo de resolveGuardRoot + resolveTargetBase (glory-sentinel/src/core/scheduler.ts). */
export function guardRootPorDefecto(env: NodeJS.ProcessEnv = process.env): string {
  let base: string;
  if (env.CARGO_TARGET_DIR_BASE) base = path.resolve(env.CARGO_TARGET_DIR_BASE);
  else if (process.platform === 'win32') base = path.join(raizTemporales(env), 'glory-target');
  else base = path.join(os.tmpdir(), 'glory-target');
  return path.join(path.dirname(base), 'glory-quality-guard');
}

function parseObjeto(linea: string): Record<string, unknown> | null {
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

function acotar(valor: string): string {
  return valor.slice(0, MAX_LONGITUD_TEXTO);
}

/* Lee las últimas `maxBytes` de un fichero. null si no existe o no es un fichero
 * regular. Si se corta por la izquierda, descarta la primera línea (parcial). */
function leerCola(ruta: string, maxBytes: number): string[] | null {
  let fd: number;
  try {
    fd = openSync(ruta, 'r');
  } catch {
    return null;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return null;
    const inicio = Math.max(0, info.size - maxBytes);
    const largo = info.size - inicio;
    const buf = Buffer.alloc(largo);
    let leido = 0;
    while (leido < largo) {
      const n = readSync(fd, buf, leido, largo - leido, inicio + leido);
      if (n === 0) break;
      leido += n;
    }
    let texto = buf.subarray(0, leido).toString('utf8');
    if (inicio > 0) {
      const salto = texto.indexOf('\n');
      texto = salto === -1 ? '' : texto.slice(salto + 1);
    }
    return texto.split('\n');
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function leerLineasDiario(lineas: string[]): { entradas: EntradaDiario[]; corruptas: number } {
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

function leerLineasAuditoria(lineas: string[]): { entradas: EntradaAuditoria[]; corruptas: number } {
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

function coincideComando(comando: string | undefined, filtro: string | undefined): boolean {
  return !filtro || (comando ?? '').toLowerCase().includes(filtro.toLowerCase());
}

function coincideProyecto(proyecto: string | undefined, filtro: string | undefined): boolean {
  return !filtro || (proyecto !== undefined && normalizarRuta(proyecto) === normalizarRuta(filtro));
}

function validarFiltros(f: FiltrosActividad): void {
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

function leerLeases(guardRoot: string, ahora: number): { activos: LeaseActiva[]; expirados: number } {
  const dir = path.join(guardRoot, 'leases');
  let nombres: string[];
  try {
    nombres = readdirSync(dir).filter((n) => n.endsWith('.json')).slice(0, MAX_LEASES);
  } catch {
    return { activos: [], expirados: 0 };
  }
  const activos: LeaseActiva[] = [];
  let expirados = 0;
  for (const nombre of nombres) {
    const ruta = path.join(dir, nombre);
    try {
      if (statSync(ruta).size > BYTES_LEASE) continue;
      const r = parseObjeto(readFileSync(ruta, 'utf8'));
      if (
        !r ||
        r.schemaVersion !== 1 ||
        typeof r.id !== 'string' ||
        typeof r.pid !== 'number' ||
        typeof r.projectRoot !== 'string' ||
        typeof r.command !== 'string' ||
        typeof r.issuedAt !== 'string' ||
        typeof r.expiresAt !== 'string'
      ) {
        continue;
      }
      const expira = Date.parse(r.expiresAt);
      if (!Number.isFinite(expira) || expira <= ahora) {
        expirados += 1;
        continue;
      }
      activos.push({
        id: r.id,
        pid: r.pid,
        projectRoot: r.projectRoot.slice(0, MAX_LONGITUD_FILTRO),
        command: acotar(r.command),
        taskId: typeof r.taskId === 'string' ? acotar(r.taskId) : null,
        issuedAt: r.issuedAt,
        expiresAt: r.expiresAt,
      });
    } catch {
      continue;
    }
  }
  activos.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  return { activos, expirados };
}

/* Lee la actividad del guard. Sin registro ni leases devuelve listas vacías
 * (disponible:false), nunca lanza por ficheros ausentes. Lanza ErrorValidacion
 * solo si los filtros son inválidos. Lo más reciente va primero. */
export function leerActividad(filtros: FiltrosActividad = {}, opciones: OpcionesActividad = {}): ActividadGuardian {
  validarFiltros(filtros);
  const env = opciones.env ?? process.env;
  const logDir = opciones.logDir ?? guardLogDirPorDefecto(env);
  const guardRoot = opciones.guardRoot ?? guardRootPorDefecto(env);
  const ahora = opciones.ahora ?? Date.now();
  const limite = filtros.limite ?? LIMITE_ACTIVIDAD_DEFECTO;
  const rutaDiario = path.join(logDir, 'guard-log.ndjson');
  const rutaAuditoria = path.join(guardRoot, 'leases', 'audit.ndjson');

  /* [por que] El rotado es más antiguo: va antes en el orden cronológico. */
  const rotado = leerCola(path.join(logDir, 'guard-log.1.ndjson'), BYTES_DIARIO);
  const actual = leerCola(path.join(logDir, 'guard-log.ndjson'), BYTES_DIARIO);
  const diarioLeido = leerLineasDiario([...(rotado ?? []), ...(actual ?? [])]);
  const diarioFiltrado = diarioLeido.entradas
    .filter(
      (e) =>
        coincideProyecto(e.proyecto, filtros.proyecto) &&
        coincideComando(e.comando, filtros.comando) &&
        (!filtros.decision || e.decision === filtros.decision),
    )
    .reverse();

  const cola = leerCola(rutaAuditoria, BYTES_AUDITORIA);
  const auditoriaLeida = leerLineasAuditoria(cola ?? []);
  const auditoriaFiltrada = auditoriaLeida.entradas
    .filter((e) => coincideProyecto(e.projectRoot, filtros.proyecto) && coincideComando(e.command, filtros.comando))
    .reverse();

  return {
    origen: { diario: rutaDiario, auditoria: rutaAuditoria },
    diario: {
      disponible: rotado !== null || actual !== null,
      entradas: diarioFiltrado.slice(0, limite),
      total: diarioFiltrado.length,
      corruptas: diarioLeido.corruptas,
    },
    auditoria: {
      disponible: cola !== null,
      entradas: auditoriaFiltrada.slice(0, limite),
      total: auditoriaFiltrada.length,
      corruptas: auditoriaLeida.corruptas,
    },
    leases: leerLeases(guardRoot, ahora),
    limite,
  };
}
