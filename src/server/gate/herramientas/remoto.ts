/* Ejecución del gate en la VPS del taller (S3.7, plan taller fase 2): arma la línea de
 * comandos y la lanza. Solo ejecuta y cita: la caché y la normalización son de
 * analizador.ts, el transporte (ssh, copia, flush de la réplica) de ssh.ts, y la forma
 * del taller y la decisión de modo de config.ts.
 * [por que] Un proyecto dado de alta en el taller (taller.json) lo analiza la VPS, y
 * `analisisEn` del registro puede forzarlo. Su árbol remoto es una réplica (mutagen
 * one-way, taller.json): antes de analizar se vacía la cola de cambios (`sync flush`),
 * así el análisis ve el árbol local actual. Sin taller no hay modo remoto. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { sesionMutagen } from '../../../shared/taller/sesiones.js';
import { checkoutVarsense, cliRuntime, parsearReporte, varsenseRuntime } from './ejecucion.js';
import type { ResultadoSpawn } from './ejecucion.js';
import { type ConfigRemota, rutaRemota, rutaRuntimeRemota } from './config.js';
import { comillas, copiarEntradas, mensaje, ssh } from './ssh.js';

const execFileAsync = promisify(execFile);

const TIMEOUT_SYNC_MS = 120_000;
const TIMEOUT_SONDA_MS = 30_000;
const TIMEOUT_ANALISIS_MS = 180_000;
/* npm ci de las 3 dependencias de produccion del runtime: ~30 s en la 89. */
const TIMEOUT_DEPS_MS = 180_000;
/* El doctor no analiza el arbol: resuelve el runtime y mira la evidencia de
 * release. Lo que tarda es el viaje, no el trabajo. */
const TIMEOUT_DOCTOR_MS = 60_000;

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

/* Línea del `doctor` remoto. Se diferencia del análisis en la forma del comando:
 * `doctor` no tiene `--format`, su JSON es siempre el mismo y sale por stdout. */
export function comandoDoctor(a: {
  env: Record<string, string>;
  node: string;
  cli: string;
  workspace: string;
}): string {
  const asignaciones = Object.entries(a.env).map(([k, v]) => `${k}=${comillas(v)}`);
  return ['env', ...asignaciones, comillas(a.node), comillas(a.cli), 'doctor', '--json', '--workspace', comillas(a.workspace)].join(' ');
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

/* Deja la réplica del proyecto al día y devuelve su ruta en la 89. [por que] Tanto
 * el análisis como el doctor tienen que ver el árbol local actual: sin el flush
 * leerían la réplica de hace un rato. */
export async function prepararReplica(clave: string, cfg: ConfigRemota): Promise<string> {
  const raiz = rutaRemota(cfg, clave);
  await sincronizar(clave, cfg);
  return raiz;
}

/* Deja el runtime de sentinel listo en la 89 y devuelve con qué invocarlo. [por que]
 * El doctor y el análisis necesitan exactamente el mismo preparativo: copiar el dist
 * (tar por ssh, porque el checkout compartido vive en `<area>/.quality-tools`, fuera de
 * la raíz de cualquier proyecto y por tanto fuera de toda sesión Mutagen), instalar
 * las dependencias solo si cambió el lock, y comprobar que el CLI responde. Tenerlo
 * dos veces obligaría a mantener dos veces el mismo procedimiento de copia. Lanza si
 * no hay runtime local o si algo del viaje falla. */
async function prepararSentinelRemoto(
  clave: string,
  cfg: ConfigRemota,
  rutaLocal: string,
): Promise<{ ws: string; cli: string; env: Record<string, string>; version: string }> {
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
  const env = { GLORY_SENTINEL_SOURCE_PATH: base, GLORY_VARSENSE_SOURCE_PATH: rutaRuntimeRemota(cfg, clave, 'varsense') };
  return { ws, cli, env, version: local.version };
}

/* Sentinel en la 89. Antes se daba por hecho que `out/` llegaba por la réplica y solo
 * valía para los proyectos con `provisionPath` dentro del repo. Lanza si no hay
 * runtime local, si la copia falla o si no se obtiene reporte. */
export async function correrSentinelRemoto(clave: string, cfg: ConfigRemota, rutaLocal: string): Promise<ResultadoSpawn> {
  const rt = await prepararSentinelRemoto(clave, cfg, rutaLocal);
  const r = await ssh(cfg, comandoAnalisis({ env: rt.env, node: cfg.nodeRemoto, cli: rt.cli, verbo: 'analyze', workspace: rt.ws }), TIMEOUT_ANALISIS_MS);
  const dato = parsearReporte(r.stdout);
  if (!dato) throw new Error(`sentinel en ${cfg.host} no devolvió reporte${r.fallo ? `: ${r.fallo}` : ''}`);
  return { version: rt.version, commit: null, dato };
}

/* `sentinel doctor` en la 89. [por que] El doctor resuelve el runtime del proyecto y
 * mira su evidencia de release: es trabajo de la máquina donde vive el proyecto, igual
 * que el análisis, y en el portátil no hay con qué hacerlo (sin toolchain de Rust desde
 * 2026-10-16). Vacía la réplica aquí (y no en el llamador, como hace `analizarEnTaller`)
 * porque esta es la única llamada remota del doctor: el doctor tiene que ver el mismo
 * árbol que vio el análisis. Sale con 1 cuando hay issues y su JSON sigue siendo el
 * diagnóstico, así que se aprovecha stdout igual que en el análisis. Acotado a 2000
 * caracteres: es un resumen para el panel, no un informe. */
export async function correrDoctorRemoto(clave: string, cfg: ConfigRemota, rutaLocal: string): Promise<string> {
  await prepararReplica(clave, cfg);
  const rt = await prepararSentinelRemoto(clave, cfg, rutaLocal);
  const r = await ssh(cfg, comandoDoctor({ env: rt.env, node: cfg.nodeRemoto, cli: rt.cli, workspace: rt.ws }), TIMEOUT_DOCTOR_MS);
  const salida = r.stdout.trim();
  if (!salida) throw new Error(`sentinel doctor en ${cfg.host} no devolvió diagnóstico${r.fallo ? `: ${r.fallo}` : ''}`);
  return salida.slice(0, 2000);
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
