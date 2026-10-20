/* Ejecución del gate en la VPS del taller: lanza las herramientas en la 89. La caché y
 * la normalización son de analizador.ts; el transporte (ssh, copia) de ssh.ts; las líneas
 * de comandos de remoto/comandos.ts. [por que] El árbol remoto del proyecto es una
 * réplica (mutagen one-way): antes de analizar se vacía su cola (`sync flush`), así la
 * VPS ve el árbol local actual. Sin taller no hay modo remoto. */
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { sesionMutagen } from '../../../shared/taller/sesiones.js';
import { fuentesSentinel, fuentesVarsense, parsearReporte } from './ejecucion.js';
import type { FuentesRuntime, ResultadoSpawn } from './ejecucion.js';
import { type ConfigRemota, rutaRemota, rutaRuntimeRemota } from './config.js';
import {
  comandoAnalisis,
  comandoCompilar,
  comandoDoctor,
  comandoEstado,
  comandoLimpiar,
  comandoMarcasRepos,
  huellaFuentes,
  huellaLock,
} from './remoto/comandos.js';
import { copiarEntradas, mensaje, ssh } from './ssh.js';

const execFileAsync = promisify(execFile);

const TIMEOUT_SYNC_MS = 120_000;
const TIMEOUT_SONDA_MS = 30_000;
const TIMEOUT_ANALISIS_MS = 180_000;
/* Compilar en la 89: `npm ci` completo (con devDependencies) cuando cambia el lock y
 * luego tsc/esbuild. Es lo caro del runtime, pero solo ocurre si cambian sus fuentes. */
const TIMEOUT_COMPILA_MS = 300_000;
/* El doctor no analiza el arbol: resuelve el runtime y mira la evidencia de
 * release. Lo que tarda es el viaje, no el trabajo. */
const TIMEOUT_DOCTOR_MS = 60_000;

/* Directorios que no se recorren al buscar repos anidados. */
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
 * [por que] Mutagen ignora `.git`, así que en la réplica no existen: sin la marca,
 * varsense recorrería el repo anidado entero, mientras en local se salta. No se
 * desciende dentro del repo anidado. */
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

/* Qué se reenvía a la 89 para compilar cada runtime, y dónde sale su CLI. [por que]
 * Solo fuentes: el artefacto lo genera la 89 con su propio toolchain. Así el portátil no
 * manda `out/` ni `dist/` (que podían quedar desfasados de las fuentes). */
const RUNTIMES = {
  sentinel: {
    entradas: ['src', 'tsconfig.json', 'package.json', 'package-lock.json'],
    salida: 'out',
    cli: 'out/cli/index.js',
  },
  varsense: {
    /* [por que] esbuild.config.mjs importa scripts/alias-esbuild.mjs: sin esa entrada la
     * compilación en la 89 falla con ERR_MODULE_NOT_FOUND aunque npm ya esté en el PATH. */
    entradas: ['src', 'esbuild.config.mjs', 'scripts/alias-esbuild.mjs', 'tsconfig.json', 'package.json', 'package-lock.json'],
    salida: 'dist',
    cli: 'dist/cli/index.js',
  },
} as const;
type NombreRuntime = keyof typeof RUNTIMES;

/* Deja el runtime compilado en la 89 y devuelve su carpeta y su CLI. [por que] El
 * compilado se reutiliza mientras la huella de las fuentes no cambie; si cambia, se
 * reenvían las fuentes (borrando antes las anteriores) y se compila allí. La marca de
 * fuentes solo se escribe tras compilar con éxito, así un intento roto no deja huella
 * válida. Lanza con el motivo que da la 89 (últimas líneas del log de compilación). */
async function prepararRuntimeRemoto(
  clave: string,
  cfg: ConfigRemota,
  nombre: NombreRuntime,
  local: FuentesRuntime,
): Promise<{ base: string; cli: string }> {
  const { entradas, salida, cli: relCli } = RUNTIMES[nombre];
  const base = rutaRuntimeRemota(cfg, clave, nombre);
  const cli = `${base}/${relCli}`;
  const marca = `${base}/.fuentes-sha`;
  const huella = huellaFuentes(local.base, [...entradas]);
  const npm = `${posix.dirname(cfg.nodeRemoto)}/npm`;
  const estado = await ssh(cfg, comandoEstado({ base, marca, huella, cli }), TIMEOUT_SONDA_MS);
  if (estado.stdout.trim() === 'ok' && !estado.fallo) return { base, cli };

  const limpiar = await ssh(cfg, comandoLimpiar(base, [...entradas, salida]), TIMEOUT_SONDA_MS);
  if (limpiar.fallo) throw new Error(`limpieza de ${nombre} en ${cfg.host}: ${limpiar.fallo}`);
  try {
    await copiarEntradas(local.base, cfg, base, [...entradas]);
  } catch (err) {
    throw new Error(`copia de ${nombre} a ${cfg.host}: ${mensaje(err)}`);
  }
  const compila = await ssh(
    cfg,
    comandoCompilar({
      base,
      npm,
      nodeDir: posix.dirname(cfg.nodeRemoto),
      huella,
      huellaLock: huellaLock(join(local.base, 'package-lock.json')),
      marca,
      cli,
    }),
    TIMEOUT_COMPILA_MS,
  );
  if (compila.fallo) throw new Error(`compilación de ${nombre} en ${cfg.host}: ${compila.fallo}`);
  return { base, cli };
}

/* Sentinel en la 89. Lanza si no hay fuentes locales, si la copia o la compilación
 * fallan, o si no se obtiene reporte. */
async function prepararSentinelRemoto(
  clave: string,
  cfg: ConfigRemota,
  rutaLocal: string,
): Promise<{ ws: string; cli: string; env: Record<string, string>; version: string }> {
  const local = fuentesSentinel(rutaLocal);
  if (!local) throw new Error(`fuentes de sentinel no encontradas para ${rutaLocal}`);
  const { base, cli } = await prepararRuntimeRemoto(clave, cfg, 'sentinel', local);
  const ws = rutaRemota(cfg, clave);
  const env = { GLORY_SENTINEL_SOURCE_PATH: base, GLORY_VARSENSE_SOURCE_PATH: rutaRuntimeRemota(cfg, clave, 'varsense') };
  return { ws, cli, env, version: local.version };
}

/* Sentinel en la 89. Lanza si no hay fuentes locales, si la copia falla o si no se
 * obtiene reporte. */
export async function correrSentinelRemoto(clave: string, cfg: ConfigRemota, rutaLocal: string): Promise<ResultadoSpawn> {
  const rt = await prepararSentinelRemoto(clave, cfg, rutaLocal);
  const r = await ssh(cfg, comandoAnalisis({ env: rt.env, node: cfg.nodeRemoto, cli: rt.cli, verbo: 'analyze', workspace: rt.ws }), TIMEOUT_ANALISIS_MS);
  const dato = parsearReporte(r.stdout);
  if (!dato) throw new Error(`sentinel en ${cfg.host} no devolvió reporte${r.fallo ? `: ${r.fallo}` : ''}`);
  return { version: rt.version, commit: null, dato };
}

/* `sentinel doctor` en la 89. [por que] El doctor resuelve el runtime del proyecto y
 * mira su evidencia de release: es trabajo de la máquina donde vive el proyecto. Vacía
 * la réplica aquí, porque el doctor no pasa por analizador.ts y debe ver el mismo árbol
 * que el análisis. Acotado a 2000 caracteres: es un resumen para el panel. */
export async function correrDoctorRemoto(clave: string, cfg: ConfigRemota, rutaLocal: string): Promise<string> {
  await prepararReplica(clave, cfg);
  const rt = await prepararSentinelRemoto(clave, cfg, rutaLocal);
  const r = await ssh(cfg, comandoDoctor({ env: rt.env, node: cfg.nodeRemoto, cli: rt.cli, workspace: rt.ws }), TIMEOUT_DOCTOR_MS);
  const salida = r.stdout.trim();
  if (!salida) throw new Error(`sentinel doctor en ${cfg.host} no devolvió diagnóstico${r.fallo ? `: ${r.fallo}` : ''}`);
  return salida.slice(0, 2000);
}

/* Varsense en la 89: compila sus fuentes allí igual que sentinel. Lanza ante cualquier
 * fallo: a diferencia del local, no conserva sentinel con varsense caído; el análisis
 * remoto entero queda en 'error'. */
export async function correrVarsenseRemoto(clave: string, cfg: ConfigRemota, rutaLocal: string): Promise<ResultadoSpawn> {
  const local = fuentesVarsense();
  if (!local) throw new Error('fuentes de varsense no encontradas (falta src/ o package.json)');
  const { base, cli } = await prepararRuntimeRemoto(clave, cfg, 'varsense', local);
  const ws = rutaRemota(cfg, clave);
  /* Repos anidados: la réplica no los lleva marcados (Mutagen ignora `.git`) y
   * varsense los recorrería enteros, mientras el portátil los salta. */
  const marcas = await ssh(cfg, comandoMarcasRepos(ws, reposAnidados(rutaLocal)), TIMEOUT_SONDA_MS);
  if (marcas.fallo) throw new Error(`marcas de repos anidados en ${cfg.host}: ${marcas.fallo}`);
  const env = { GLORY_SENTINEL_SOURCE_PATH: rutaRuntimeRemota(cfg, clave, 'sentinel'), GLORY_VARSENSE_SOURCE_PATH: base };
  const r = await ssh(cfg, comandoAnalisis({ env, node: cfg.nodeRemoto, cli, verbo: 'all', workspace: ws }), TIMEOUT_ANALISIS_MS);
  const dato = parsearReporte(r.stdout);
  if (!dato) throw new Error(`varsense en ${cfg.host} no devolvió reporte${r.fallo ? `: ${r.fallo}` : ''}`);
  return { version: local.version, commit: null, dato };
}
