/* Análisis del gate en la VPS 89 (S3.7, plan taller fase 2). Solo ejecuta y cita:
 * la caché y la normalización son de analizador.ts.
 * [por que] Un proyecto con `analisisEn: "dev89"` en registro.json lo analiza la 89.
 * Su árbol remoto es una réplica (mutagen one-way, taller.json): antes de analizar se
 * vacía la cola de cambios (`sync flush`), así el análisis ve el árbol local actual.
 * Sin `analisisEn` (por defecto) nada de esto corre. */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { rutaConfigPrivada } from '../../shared/rutas.js';
import { sesionMutagen } from '../../shared/taller/sesiones.js';
import { checkoutVarsense, cliRuntime, parsearReporte, varsenseRuntime } from './ejecucion.js';
import type { ResultadoSpawn } from './ejecucion.js';

const execFileAsync = promisify(execFile);

/* [por que] Tope de salida: el reporte de un proyecto grande (PROYECTO TASKS, 993
 * archivos) supera el maxBuffer por defecto de execFile (1 MiB). */
export const MAX_SALIDA = 64 * 1024 * 1024;
const TIMEOUT_SYNC_MS = 120_000;
const TIMEOUT_SONDA_MS = 30_000;
const TIMEOUT_ANALISIS_MS = 180_000;
const TIMEOUT_COPIA_MS = 120_000;
/* npm ci de las 3 dependencias de produccion del runtime: ~30 s en la 89. */
const TIMEOUT_DEPS_MS = 180_000;

const RAIZ_WM = join(import.meta.dirname, '..', '..', '..');
const RUTA_TALLER = join(RAIZ_WM, 'config', 'taller.json');
const RUTA_REGISTRO = join(RAIZ_WM, 'config', 'registro.json');

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

/* Runtime de una herramienta para un proyecto, FUERA de su réplica:
 * <dirRemotoBase>/_quality-tools/<clave>/<tool>. [por que] Dentro de la réplica no
 * puede vivir: la sincronización es unidireccional y borra todo lo que no esté en el
 * portátil, así que el runtime copiado desaparecería en el siguiente flush. Y el
 * checkout compartido (`<area>/.quality-tools`) queda fuera de la raíz de cualquier
 * proyecto, así que ninguna sesión lo lleva. El prefijo `_` sigue la convención de
 * `_logs`/`_datos` para lo que no es réplica. */
export function rutaRuntimeRemota(cfg: ConfigRemota, clave: string, tool: string): string {
  rutaRemota(cfg, clave);
  return `${cfg.dirRemotoBase.replace(/\/+$/, '')}/_quality-tools/${clave}/${tool}`;
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

/* Comprueba que el CLI está en su sitio, en una sola ida y vuelta. [por que] La
 * versión no se lee de la 89: el runtime lo acaba de copiar el portátil, así que
 * la sabe de origen y ahorra una lectura remota. */
export function comandoSonda(cli: string): string {
  return `test -f ${comillas(cli)} && echo ok`;
}

/* Huella del package-lock: identifica el juego de dependencias. [por que] La versión
 * no sirve de marca: el lock puede cambiar sin subir versión. mtime sí cambiaría en un
 * `git checkout` sin cambios de contenido y reinstalaría de balde. */
export function huellaLock(ruta: string): string {
  try {
    return createHash('sha256').update(readFileSync(ruta)).digest('hex').slice(0, 16);
  } catch {
    return '?';
  }
}

/* Instala las dependencias del runtime en la 89, solo cuando el lock cambió. [por que]
 * `out/` se copia en cada análisis (4,5 MB) pero `node_modules` son 61 MB: copiarlo
 * cada vez no tiene sentido. El runtime usa 3 dependencias de producción, así que
 * `npm ci --omit=dev` en la 89 es barato y deja el árbol reproducible. Si `npm ci`
 * falla sale con 3: la sonda lo ve como fallo y el análisis remoto queda en 'error'
 * con motivo, en vez de reventar más tarde con un «Cannot find module». */
export function comandoDeps(npm: string, base: string, huella: string): string {
  const marca = `${base}/.lock-sha`;
  return (
    `if [ "$(cat ${comillas(marca)} 2>/dev/null)" != ${comillas(huella)} ]; then ` +
    `${comillas(npm)} ci --omit=dev --silent --prefix ${comillas(base)} >/dev/null 2>&1 && ` +
    `printf '%s' ${comillas(huella)} > ${comillas(marca)} || exit 3; fi; echo ok`
  );
}

/* Directorios no recorridos al buscar repos anidados (mismos que el analizador). */
const DIRS_NO_RECORRIDOS = new Set([
  'node_modules', 'target', 'dist', 'build', '.git', '.quality-tools', '.quality-reports', '.sentinel',
]);

export interface RepoAnidado {
  /** Ruta relativa al proyecto, con `/`. */
  ruta: string;
  /** Contenido del `.git` si es fichero (submódulo/worktree); null si es directorio. */
  marca: string | null;
}

/* undefined si no hay repo anidado; null si `.git` es directorio; si no, su contenido. */
function leerMarcaGit(ruta: string): string | null | undefined {
  try {
    return statSync(ruta).isDirectory() ? null : readFileSync(ruta, 'utf8').trim();
  } catch {
    return undefined;
  }
}

/* Repos anidados del árbol local: los marca un `.git` que es fichero o directorio.
 * [por que] Mutagen ignora `.git`, así que en la réplica no existen y varsense
 * recorrería el submódulo entero, que en el portátil salta (nodeProviders.walk).
 * El mismo árbol daría resultados distintos: KAMPLES daba 0 clases huérfanas en
 * local y 3 en la 89 (`glory-rs/frontend/estilos/Componentes.css`), porque la 89
 * veía ese CSS y el portátil no. No se desciende dentro del repo anidado, igual
 * que el analizador. */
export function reposAnidados(raiz: string): RepoAnidado[] {
  const encontrados: RepoAnidado[] = [];
  const pendientes = [''];
  while (pendientes.length > 0) {
    const rel = pendientes.pop() as string;
    const abs = rel ? join(raiz, rel) : raiz;
    let entradas;
    try {
      entradas = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      if (!entrada.isDirectory() || DIRS_NO_RECORRIDOS.has(entrada.name)) continue;
      const sub = rel ? `${rel}/${entrada.name}` : entrada.name;
      const marca = leerMarcaGit(join(abs, entrada.name, '.git'));
      if (marca === undefined) {
        pendientes.push(sub);
        continue;
      }
      encontrados.push({ ruta: sub, marca });
    }
  }
  return encontrados.sort((a, b) => a.ruta.localeCompare(b.ruta));
}

/* Recrea esas marcas en la réplica. [por que] Viven bajo una ruta que Mutagen
 * ignora, así que la sincronización no las borra y quedan estables entre flushes. */
export function comandoMarcasRepos(ws: string, repos: RepoAnidado[]): string {
  const partes = repos.map((r) => {
    const dir = `${ws}/${r.ruta}`;
    const marca = `${dir}/.git`;
    return r.marca === null
      ? `mkdir -p ${comillas(marca)}`
      : `mkdir -p ${comillas(dir)} && printf '%s' ${comillas(r.marca)} > ${comillas(marca)}`;
  });
  return [...partes, 'echo ok'].join(' && ');
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
  const sesion = sesionMutagen(clave);
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

/* Sentinel en la 89. [por que] El runtime se copia (tar por ssh) en vez de esperarlo
 * de Mutagen: el checkout compartido vive en `<area>/.quality-tools`, fuera de la raíz
 * de cualquier proyecto, así que no hay sesión que lo lleve. Antes se daba por hecho
 * que `out/` llegaba por la réplica y solo valía para los proyectos con
 * `provisionPath` dentro del repo. Lanza si no hay runtime local, si la copia falla
 * o si no se obtiene reporte. */
export async function correrSentinelRemoto(clave: string, cfg: ConfigRemota, rutaLocal: string): Promise<ResultadoSpawn> {
  const local = cliRuntime(rutaLocal);
  if (!local) throw new Error(`runtime sentinel local no provisionado para ${rutaLocal}`);
  const ws = rutaRemota(cfg, clave);
  const base = rutaRuntimeRemota(cfg, clave, 'sentinel');
  const cli = `${base}/out/cli/index.js`;
  try {
    await copiarEntradas(local.base, cfg, base, ['out', 'package.json', 'package-lock.json']);
  } catch (err) {
    throw new Error(`copia de sentinel a ${cfg.host}: ${mensaje(err)}`);
  }
  const npm = `${posix.dirname(cfg.nodeRemoto)}/npm`;
  const deps = await ssh(cfg, comandoDeps(npm, base, huellaLock(join(local.base, 'package-lock.json'))), TIMEOUT_DEPS_MS);
  if (deps.fallo) throw new Error(`dependencias de sentinel en ${cfg.host}: ${deps.fallo}`);
  const sonda = await ssh(cfg, comandoSonda(cli), TIMEOUT_SONDA_MS);
  if (sonda.fallo) throw new Error(`runtime sentinel no disponible en ${cfg.host} (${cli}): ${sonda.fallo}`);
  const version = local.version;
  const env = { GLORY_SENTINEL_SOURCE_PATH: base, GLORY_VARSENSE_SOURCE_PATH: rutaRuntimeRemota(cfg, clave, 'varsense') };
  const r = await ssh(cfg, comandoAnalisis({ env, node: cfg.nodeRemoto, cli, verbo: 'analyze', workspace: ws }), TIMEOUT_ANALISIS_MS);
  const dato = parsearReporte(r.stdout);
  if (!dato) throw new Error(`sentinel en ${cfg.host} no devolvió reporte${r.fallo ? `: ${r.fallo}` : ''}`);
  return { version, commit: null, dato };
}

/* Resuelve con null si el proceso salió bien, o con el motivo si falló. */
function esperarProceso(p: ChildProcess, nombre: string): Promise<string | null> {
  return new Promise((resolve) => {
    let err = '';
    p.stderr?.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve(`${nombre}: ${e.message}`));
    p.on('close', (code) => resolve(code === 0 ? null : `${nombre} salió con ${code ?? 'señal'}: ${err.trim()}`));
  });
}

/* Copia entradas (ficheros o directorios, relativas a `base`) al `destino` remoto,
 * que se crea si falta. [por que] tar por ssh y no `scp -r`: con este dist (180
 * archivos, 1,7 MB) scp se quedaba colgado hasta el timeout (probado 2026-10-15);
 * tar por ssh copia en ~8 s. */
async function copiarEntradas(base: string, cfg: ConfigRemota, destino: string, entradas: string[]): Promise<void> {
  const remoto = `mkdir -p ${comillas(destino)} && tar -C ${comillas(destino)} -xf -`;
  const tar = spawn('tar', ['-C', base, '-cf', '-', ...entradas], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
export async function correrVarsenseRemoto(clave: string, cfg: ConfigRemota, rutaLocal: string): Promise<ResultadoSpawn> {
  const local = checkoutVarsense();
  const vs = varsenseRuntime();
  if (!local || !vs) throw new Error('runtime varsense local no provisionado');
  const ws = rutaRemota(cfg, clave);
  const base = rutaRuntimeRemota(cfg, clave, 'varsense');
  const cli = `${base}/dist/cli/index.js`;
  try {
    /* `package.json` viaja con el dist: el CLI lo lee para resolver su versión. */
    await copiarEntradas(local, cfg, base, ['dist', 'package.json']);
  } catch (err) {
    throw new Error(`copia de varsense a ${cfg.host}: ${mensaje(err)}`);
  }
  /* Repos anidados: la réplica no los lleva marcados (Mutagen ignora `.git`) y
   * varsense los recorrería enteros, mientras el portátil los salta. */
  const marcas = await ssh(cfg, comandoMarcasRepos(ws, reposAnidados(rutaLocal)), TIMEOUT_SONDA_MS);
  if (marcas.fallo) throw new Error(`marcas de repos anidados en ${cfg.host}: ${marcas.fallo}`);
  const env = { GLORY_SENTINEL_SOURCE_PATH: rutaRuntimeRemota(cfg, clave, 'sentinel'), GLORY_VARSENSE_SOURCE_PATH: base };
  const r = await ssh(cfg, comandoAnalisis({ env, node: cfg.nodeRemoto, cli, verbo: 'all', workspace: ws }), TIMEOUT_ANALISIS_MS);
  const dato = parsearReporte(r.stdout);
  if (!dato) throw new Error(`varsense en ${cfg.host} no devolvió reporte${r.fallo ? `: ${r.fallo}` : ''}`);
  return { version: vs.version, commit: null, dato };
}
