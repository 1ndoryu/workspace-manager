/* Actividad del Guardián (10AA-2 F11.4, sección «Actividad»): lee el diario de
 * decisiones de Sentinel (F11.2) y la auditoría de leases SIN escribir nada.
 * [por que] Ambos ficheros los escribe el guard fuera de los proyectos; la
 * pestaña solo los presenta. audit.ndjson no rota, así que se lee solo su cola
 * acotada; el diario se lee entero porque rota a 1 MiB. Las líneas corruptas se
 * cuentan y no rompen la lectura. Las rutas por defecto espejan guardLogDir y
 * resolveGuardRoot de glory-sentinel: si cambian allí, cambian aquí. Los leases
 * se muestran sin la firma.
 * Parseo puro en actividad/actividad-parseo.ts, tipos en actividad/actividad-tipos.ts
 * y lectura en disco en actividad/actividad-io.ts; aquí queda la fachada. */
import os from 'node:os';
import path from 'node:path';
import { raizTemporales } from '../../plataforma/temporales.js';
import { leerCola, leerLeases } from './actividad/actividad-io.js';
import {
  coincideComando,
  coincideProyecto,
  leerLineasAuditoria,
  leerLineasDiario,
  validarFiltros,
} from './actividad/actividad-parseo.js';
import {
  LIMITE_ACTIVIDAD_DEFECTO,
  type ActividadGuardian,
  type FiltrosActividad,
  type OpcionesActividad,
} from './actividad/actividad-tipos.js';

export {
  DECISIONES_REGISTRO,
  LIMITE_ACTIVIDAD_DEFECTO,
  LIMITE_ACTIVIDAD_MAX,
} from './actividad/actividad-tipos.js';
export type {
  DecisionRegistro,
  EventoAuditoria,
  EntradaDiario,
  EntradaAuditoria,
  LeaseActiva,
  FiltrosActividad,
  OpcionesActividad,
  SeccionLectura,
  ActividadGuardian,
} from './actividad/actividad-tipos.js';

/* [por que] Cada fichero del diario se capa a 1 MiB por rotación; audit.ndjson no
 * rota, así que su cola se acota para que una auditoría enorme no bloquee la página. */
const BYTES_DIARIO = 1024 * 1024;
const BYTES_AUDITORIA = 512 * 1024;

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
