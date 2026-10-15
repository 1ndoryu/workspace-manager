/* Análisis del gate en la VPS 89 (S3.7, plan taller fase 2). Solo ejecuta y cita:
 * la caché y la normalización son de analizador.ts.
 * [por que] Un proyecto con `analisisEn: "dev89"` en registro.json lo analiza la 89.
 * Su árbol remoto es una réplica (mutagen one-way, taller.json): antes de analizar se
 * vacía la cola de cambios (`sync flush`), así el análisis ve el árbol local actual.
 * Sin `analisisEn` (por defecto) nada de esto corre. */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkoutVarsense, parsearReporte, varsenseRuntime } from './ejecucion.js';
import type { ResultadoSpawn } from './ejecucion.js';

const execFileAsync = promisify(execFile);

/* [por que] Tope de salida: el reporte de un proyecto grande (PROYECTO TASKS, 993
 * archivos) supera el maxBuffer por defecto de execFile (1 MiB). */
export const MAX_SALIDA = 64 * 1024 * 1024;
const TIMEOUT_SYNC_MS = 120_000;
const TIMEOUT_SONDA_MS = 30_000;
const TIMEOUT_ANALISIS_MS = 180_000;
const TIMEOUT_COPIA_MS = 120_000;

const RAIZ_WM = join(import.meta.dirname, '..', '..', '..');
const RUTA_TALLER = join(RAIZ_WM, 'scripts', 'remoto', 'taller.json');
const RUTA_REGISTRO = join(RAIZ_WM, 'scripts', 'dev', 'registro.json');

export type ModoAnalisis = 'local' | 'dev89';

export interface ConfigRemota {
  host: string;
  dirRemotoBase: string;
  nodeRemoto: string;
  mutagen: string;
}

const RUTA_ABSOLUTA_SEGURA = /^\/[A-Za-z0-9._/-]+$/;

/* Valida la parte de taller.json que usa el análisis. Las rutas remotas van a una
 * línea de comandos del shell de la 89: solo se admiten caracteres seguros. */
export function configRemotaDe(t: {
  host?: unknown;
  dirRemotoBase?: unknown;
  nodeRemoto?: unknown;
  sync?: { binario?: unknown };
}): ConfigRemota {
  const { host, dirRemotoBase, nodeRemoto } = t;
  const mutagen = t.sync?.binario;
  if (typeof host !== 'string' || typeof dirRemotoBase !== 'string' || typeof nodeRemoto !== 'string' || typeof mutagen !== 'string') {
    throw new Error('taller.json: faltan host, dirRemotoBase, nodeRemoto o sync.binario');
  }
  if (!RUTA_ABSOLUTA_SEGURA.test(dirRemotoBase)) throw new Error(`taller.json: dirRemotoBase '${dirRemotoBase}' debe ser una ruta absoluta simple`);
  if (!RUTA_ABSOLUTA_SEGURA.test(nodeRemoto)) throw new Error(`taller.json: nodeRemoto '${nodeRemoto}' debe ser una ruta absoluta simple`);
  return { host, dirRemotoBase, nodeRemoto, mutagen };
}

export function leerConfigRemota(): ConfigRemota {
  return configRemotaDe(JSON.parse(readFileSync(RUTA_TALLER, 'utf8')));
}

/* Modo de análisis del proyecto según su entrada del registro. Por defecto, local. */
export function modoAnalisisEn(
  registro: { proyectos?: Array<{ id?: unknown; analisisEn?: unknown }> },
  clave: string,
): ModoAnalisis {
  const entrada = registro.proyectos?.find((x) => x.id === clave);
  return entrada?.analisisEn === 'dev89' ? 'dev89' : 'local';
}

export function modoAnalisis(clave: string): ModoAnalisis {
  return modoAnalisisEn(JSON.parse(readFileSync(RUTA_REGISTRO, 'utf8')), clave);
}

/* Cita un valor para el shell remoto (POSIX): comillas simples, con ' escapada. */
export function comillas(valor: string): string {
  return `'${valor.replace(/'/g, `'\\''`)}'`;
}

/* Ruta remota del proyecto: <dirRemotoBase>/<clave>. La clave tampoco puede traer
 * espacios ni metacaracteres (mismo criterio que la ruta base). */
export function rutaRemota(cfg: ConfigRemota, clave: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(clave)) throw new Error(`clave '${clave}' no válida para una ruta remota`);
  return `${cfg.dirRemotoBase.replace(/\/+$/, '')}/${clave}`;
}

/* Línea de comandos del análisis remoto: entorno de los runtimes de la 89 + CLI. */
export function comandoAnalisis(a: {
  env: Record<string, string>;
  node: string;
  cli: string;
  verbo: 'analyze' | 'all';
  workspace: string;
}): string {
  const asignaciones = Object.entries(a.env).map(([k, v]) => `${k}=${comillas(v)}`);
  return ['env', ...asignaciones, comillas(a.node), comillas(a.cli), a.verbo, '--workspace', comillas(a.workspace), '--format', 'json'].join(' ');
}

/* Comprueba que el CLI existe y lee la versión de su package.json, en una sola ida y vuelta. */
export function comandoVersion(node: string, cli: string, pkg: string): string {
  return `test -f ${comillas(cli)} && ${comillas(node)} -p ${comillas(`require(${JSON.stringify(pkg)}).version`)}`;
}

export function mensaje(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown };
  const texto = typeof e.stderr === 'string' && e.stderr.trim() ? e.stderr : typeof e.message === 'string' ? e.message : String(err);
  return texto.trim();
}

export interface SalidaSsh {
  stdout: string;
  fallo: string | null;
}

/* Ejecuta un comando en la 89. A diferencia de execFile, devuelve la salida también
 * si sale con código ≠ 0: sentinel y varsense salen así cuando hay hallazgos de
 * severidad error (el reporte válido va en stdout). -n: no lee stdin. */
export async function ssh(cfg: ConfigRemota, comando: string, timeout: number): Promise<SalidaSsh> {
  try {
    const { stdout } = await execFileAsync(
      'ssh',
      ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', cfg.host, comando],
      { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: MAX_SALIDA },
    );
    return { stdout, fallo: null };
  } catch (err) {
    const e = err as { stdout?: string };
    return { stdout: e.stdout ?? '', fallo: mensaje(err) };
  }
}

/* Vacía la cola de cambios de la sesión mutagen del proyecto (`taller-<clave>`, la
 * misma que usa rcargo.mjs). Tras esto la réplica de la 89 coincide con el árbol local.
 * Lanza si no puede (sesión ausente, cola atascada o timeout). */
export async function sincronizar(clave: string, cfg: ConfigRemota): Promise<void> {
  const sesion = `taller-${clave}`;
  try {
    await execFileAsync(cfg.mutagen, ['sync', 'flush', sesion], {
      encoding: 'utf8',
      timeout: TIMEOUT_SYNC_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`mutagen sync flush ${sesion}: ${mensaje(err)}`);
  }
}

/* Sentinel en la 89 (su runtime llega por la réplica: `out/` no está en la lista de
 * ignorados de taller.json). Lanza si el CLI no existe o no se obtiene reporte. */
export async function correrSentinelRemoto(clave: string, cfg: ConfigRemota): Promise<ResultadoSpawn> {
  const ws = rutaRemota(cfg, clave);
  const base = `${ws}/.quality-tools/sentinel`;
  const cli = `${base}/out/cli/index.js`;
  const sonda = await ssh(cfg, comandoVersion(cfg.nodeRemoto, cli, `${base}/package.json`), TIMEOUT_SONDA_MS);
  if (sonda.fallo) throw new Error(`runtime sentinel no disponible en ${cfg.host} (${cli}): ${sonda.fallo}`);
  const version = sonda.stdout.trim() || '?';
  const env = { GLORY_SENTINEL_SOURCE_PATH: base, GLORY_VARSENSE_SOURCE_PATH: `${ws}/.quality-tools/varsense` };
  const r = await ssh(cfg, comandoAnalisis({ env, node: cfg.nodeRemoto, cli, verbo: 'analyze', workspace: ws }), TIMEOUT_ANALISIS_MS);
  const dato = parsearReporte(r.stdout);
  if (!dato) throw new Error(`sentinel en ${cfg.host} no devolvió reporte${r.fallo ? `: ${r.fallo}` : ''}`);
  return { version, commit: null, dato };
}

/* [por que] tar por ssh y no `scp -r`: con este dist (180 archivos, 1,7 MB) scp se
 * quedaba colgado hasta el timeout (probado 2026-10-15); tar por ssh copia en ~8 s. */
function esperarProceso(p: ChildProcess, nombre: string): Promise<string | null> {
  return new Promise((resolve) => {
    let err = '';
    p.stderr?.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve(`${nombre}: ${e.message}`));
    p.on('close', (code) => resolve(code === 0 ? null : `${nombre} salió con ${code ?? 'señal'}: ${err.trim()}`));
  });
}

async function copiarDirectorio(origen: string, cfg: ConfigRemota, destino: string): Promise<void> {
  const remoto = `mkdir -p ${comillas(destino)} && tar -C ${comillas(destino)} -xf -`;
  const tar = spawn('tar', ['-C', origen, '-cf', '-', '.'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const ssh = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', cfg.host, remoto], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  tar.stdout.pipe(ssh.stdin);
  ssh.stdin.on('error', () => {}); // si ssh cae antes, su código de salida ya lo informa
  const reloj = setTimeout(() => { tar.kill(); ssh.kill(); }, TIMEOUT_COPIA_MS);
  try {
    const fallos = await Promise.all([esperarProceso(tar, 'tar'), esperarProceso(ssh, 'ssh')]);
    const motivos = fallos.filter((f): f is string => f !== null);
    if (motivos.length) throw new Error(motivos.join('; '));
  } finally {
    clearTimeout(reloj);
  }
}

/* Varsense en la 89. Mutagen ignora `dist`, así que el runtime local se copia antes
 * (tar por ssh, sobrescribe). Lanza ante cualquier fallo: a diferencia del local, no
 * conserva sentinel con varsense caído; el análisis remoto entero queda en 'error'. */
export async function correrVarsenseRemoto(clave: string, cfg: ConfigRemota): Promise<ResultadoSpawn> {
  const local = checkoutVarsense();
  const vs = varsenseRuntime();
  if (!local || !vs) throw new Error('runtime varsense local no provisionado');
  const ws = rutaRemota(cfg, clave);
  const base = `${ws}/.quality-tools/varsense`;
  const cli = `${base}/dist/cli/index.js`;
  try {
    await copiarDirectorio(join(local, 'dist'), cfg, `${base}/dist`);
  } catch (err) {
    throw new Error(`copia de varsense a ${cfg.host}: ${mensaje(err)}`);
  }
  const env = { GLORY_SENTINEL_SOURCE_PATH: `${ws}/.quality-tools/sentinel`, GLORY_VARSENSE_SOURCE_PATH: base };
  const r = await ssh(cfg, comandoAnalisis({ env, node: cfg.nodeRemoto, cli, verbo: 'all', workspace: ws }), TIMEOUT_ANALISIS_MS);
  const dato = parsearReporte(r.stdout);
  if (!dato) throw new Error(`varsense en ${cfg.host} no devolvió reporte${r.fallo ? `: ${r.fallo}` : ''}`);
  return { version: vs.version, commit: null, dato };
}
