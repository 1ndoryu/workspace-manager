/* Escaner Git: lee estado de un repositorio usando solo `git` CLI + filesystem.
 * [por que] Sin libgit2 ni binarios nativos: funciona en cualquier entorno y es
 * el mismo enfoque ligero del resto del proyecto. */
import { execFile, execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { BIN_GIT } from '../plataforma/binarios.js';
import type { ArchivoLocal, CommitResumen, DetalleRepoSync, EstadoGit, LadoSync } from '../../shared/types.js';
import { commondirDe, detectarGit, gitdirDe, type InfoGit } from './gitDeteccion.js';

/* Cuanto se espera a git antes de darlo por colgado. [por que] Un repo con un
 * hook o un filtro lento bloquea el escaneo entero; 10 s es el tope que ya
 * tenian los dos sitios que lanzaban git. */
const TIMEOUT_GIT_MS = 10_000;

/* detectarGit se reexporta para no tocar a quien ya lo importaba de aqui
 * (workspace.ts, git.test.ts). [por que] El corte de 17AA-2 saco a
 * gitDeteccion.ts lo que se responde sin arrancar git; la superficie publica
 * de este modulo no cambia. */
export { detectarGit, type InfoGit };

/** Opciones con las que el manager lanza git: sin shell, acotado y sin ventana.
 * [por que] El objeto estaba copiado byte a byte aqui y en gitDiffs.ts: dos
 * sitios que deciden lo mismo y que solo coinciden por disciplina. El dia que
 * uno suba el timeout o acote `maxBuffer`, el otro miente sobre cuanto puede
 * tardar o cuanto puede leer. */
export function opcionesGit(cwd: string): ExecFileSyncOptionsWithStringEncoding {
  return {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_GIT_MS,
    windowsHide: true,
  };
}

/** Ejecuta git con args en un cwd, devolviendo salida limpia o null si falla.
 * Exportado para gitDiffs.js (mismo dominio, [299A-11] Bloque E). */
/* [por que] Solo trimEnd, nunca trim: en `status --porcelain` el espacio
 * inicial de la PRIMERA linea es dato (columna X del formato `XY ruta`;
 * p. ej. ` M roadmap.md` = modificado sin staged). Un trim completo lo
 * comia y la primera entrada salia con la ruta truncada (`oadmap.md`) y
 * el estado cambiado a staged (289A-6). */
export function git(ruta: string, args: string[]): string | null {
  try {
    return execFileSync(BIN_GIT, args, opcionesGit(ruta)).trimEnd();
  } catch {
    return null;
  }
}

/* Igual que `git`, pero sin bloquear el event loop: el escaneo del workspace lo usa
 * para leer varios repos a la vez. [por que] `execFileSync` esperaba a cada git en
 * serie (cifra antigua de 21 repos ≈ 8 s, no reproducida en la 89; ver
 * docs/rendimiento.md); con esto el coste se solapa. */
export function gitAsync(ruta: string, args: string[]): Promise<string | null> {
  return new Promise((resolver) => {
    execFile(BIN_GIT, args, opcionesGit(ruta), (err, salida) => {
      resolver(err ? null : String(salida).trimEnd());
    });
  });
}

/** Puerto de git: lo que el escáner necesita de git, sin depender del proceso concreto.
 * [por que] Con el puerto, quien lee estado (rutas, salud, pruebas) puede inyectar una
 * salida fija en vez de lanzar git; `PUERTO_GIT` es la implementación por defecto. */
export interface PuertoGit {
  git(ruta: string, args: string[]): string | null;
  gitAsync(ruta: string, args: string[]): Promise<string | null>;
}

/** Implementación por defecto del puerto: el git real del sistema. */
export const PUERTO_GIT: PuertoGit = { git, gitAsync };

/** Rama primaria declarada por el proyecto (AGENTS.md / sentinel.config.json), nunca inferir 'main'. */
export function ramaPrimariaDeclarada(ruta: string): string {
  const config = join(ruta, 'sentinel.config.json');
  if (existsSync(config)) {
    try {
      const data = JSON.parse(readFileSync(config, 'utf8'));
      const primaria = data?.project?.primaryBranch ?? data?.primaryBranch;
      if (typeof primaria === 'string' && primaria) return primaria;
    } catch {
      /* config invalida -> fallback */
    }
  }
  /* ultimo recurso: rama por defecto del remoto si existe, si no 'main' solo como fallback documentado */
  return 'main';
}


/* URL de origin leida de `.git/config`. null si no hay origin o no se puede
 * leer. [por que] `git remote get-url origin` costaba un proceso por repo
 * (~43 ms en el portatil, medido en el escaneo raiz): el dato esta en un
 * fichero de texto. Lo que la lectura directa no puede resolver se le deja a
 * git (ver el guardia de `include`/`url` mas abajo). */
function leerRemotoDirecto(ruta: string): string | null | undefined {
  const gitdir = gitdirDe(ruta);
  if (!gitdir) return null;
  let config: string;
  try {
    config = readFileSync(join(commondirDe(gitdir), 'config'), 'utf8');
  } catch {
    return null;
  }
  /* [por que] `include` trae mas config y `url.<base>.insteadOf` reescribe la URL:
   * en esos dos casos la lectura directa no ve lo que git responderia. Se devuelve
   * `undefined` para que quien llama pregunte a git (sincrona o asincronamente). */
  if (/^\s*\[(include|url)\b/m.test(config)) return undefined;
  const seccion = config.match(/\[remote\s+"origin"\]\s*([\s\S]*?)(?=\n\s*\[|$)/);
  if (!seccion) return null;
  const url = seccion[1].match(/^\s*url\s*=\s*(.+)$/m);
  return url ? url[1].trim() : null;
}

/* Cabecera de `git status --porcelain --branch`: rama, upstream y ahead/behind.
 * [por que] Un solo proceso da lo que antes pedian tres (`symbolic-ref`,
 * `rev-list --left-right` y `status`). Formatos posibles:
 *   `## main...origin/main [ahead 1, behind 2]`   normal con upstream
 *   `## main...origin/main [gone]`               upstream borrado
 *   `## main`                                    sin upstream
 *   `## HEAD (no branch)`                        detached
 *   `## No commits yet on main`                  repo sin commits (unborn) */
function leerCabeceraStatus(cabecera: string): { rama: string; ahead: number; behind: number } {
  const cuerpo = cabecera.slice(3).trim();
  if (/^HEAD \(no branch\)$/.test(cuerpo)) return { rama: 'DETACHED', ahead: 0, behind: 0 };
  const unborn = cuerpo.match(/^No commits yet on (.+)$/);
  if (unborn) return { rama: unborn[1], ahead: 0, behind: 0 };
  const rama = cuerpo.split('...')[0].trim();
  const cuenta = cuerpo.match(/\[ahead (\d+)(?:, behind (\d+))?\]/) ?? cuerpo.match(/\[behind (\d+)\]/);
  /* `[behind N]` sin ahead: el primer grupo del segundo patron es el de behind. */
  const soloBehind = cuerpo.includes('[behind') && !cuerpo.includes('[ahead');
  return {
    rama,
    ahead: soloBehind ? 0 : Number(cuenta?.[1] ?? 0) || 0,
    behind: soloBehind ? Number(cuenta?.[1] ?? 0) || 0 : Number(cuenta?.[2] ?? 0) || 0,
  };
}

const ARGS_STATUS = ['status', '--porcelain', '--branch'];
const ARGS_LOG = ['log', '-1', '--format=%H%x09%ci%x09%s'];
const ARGS_REMOTO = ['remote', 'get-url', 'origin'];

/** Estado completo de un repo (sincrono). El escaneo del workspace usa `estadoGitAsync`. */
export function estadoGit(ruta: string, puerto: PuertoGit = PUERTO_GIT): EstadoGit {
  const status = puerto.git(ruta, ARGS_STATUS) ?? '';
  const log = puerto.git(ruta, ARGS_LOG);
  const directo = leerRemotoDirecto(ruta);
  return construirEstadoGit(ruta, status, log, directo !== undefined ? directo : puerto.git(ruta, ARGS_REMOTO), puerto);
}

/** Igual que `estadoGit` pero sin bloquear: los git de varios repos pueden correr a la vez.
 * [por que] Mismo resultado; solo cambia que la espera no congela el event loop. */
export async function estadoGitAsync(ruta: string, puerto: PuertoGit = PUERTO_GIT): Promise<EstadoGit> {
  const status = (await puerto.gitAsync(ruta, ARGS_STATUS)) ?? '';
  const log = await puerto.gitAsync(ruta, ARGS_LOG);
  const directo = leerRemotoDirecto(ruta);
  const remoto = directo !== undefined ? directo : await puerto.gitAsync(ruta, ARGS_REMOTO);
  return construirEstadoGit(ruta, status, log, remoto, puerto);
}

/* Arma el estado con la salida de git ya leida. No lanza procesos propios. */
function construirEstadoGit(
  ruta: string,
  status: string,
  ultimoCommit: string | null,
  remoto: string | null,
  puerto: PuertoGit,
): EstadoGit {
  /* [por que] `git rev-parse --abbrev-ref HEAD` devuelve "HEAD" tanto en detached
   * como en repo vacio (unborn, sin commits). La cabecera de `status --branch`
   * los distingue (`## HEAD (no branch)`, `## No commits yet on <rama>`), asi que
   * no hace falta preguntarlo aparte. */
  const lineas = status.split('\n');
  const cabecera = lineas[0]?.startsWith('## ') ? lineas[0] : null;
  const info = cabecera
    ? leerCabeceraStatus(cabecera)
    : /* Sin cabecera no hubo respuesta de git (carpeta que no es repo): se
       * reporta como repo sin commits, que es lo que se deducia antes al fallar
       * tambien `symbolic-ref` y `rev-parse --verify HEAD`. */
      { rama: `${ramaPrimariaDeclarada(ruta)} (sin commits)`, ahead: 0, behind: 0 };
  /* El cuerpo empieza en la segunda linea; el espacio inicial de la primera
   * entrada (` M ruta`) es dato y no se toca. */
  const cuerpo = (cabecera ? lineas.slice(1) : lineas).join('\n');
  const dirty = cuerpo.length > 0;

  const submodulos = leerSubmodulos(ruta);
  let commit: EstadoGit['ultimoCommit'] = null;
  if (ultimoCommit) {
    const [hash, fecha, ...resto] = ultimoCommit.split('\t');
    commit = { hash, fecha, mensaje: resto.join('\t') };
  }

  return {
    rama: info.rama,
    remoto,
    ramaPrimaria: ramaPrimariaDeclarada(ruta),
    dirty,
    ahead: info.ahead,
    behind: info.behind,
    cambios: contarCambios(cuerpo),
    worktreesOrfanos: worktreesOrfanos(ruta, puerto),
    submodulos,
    ultimoCommit: commit,
  };
}

/* Cuenta cambios locales por tipo desde `git status --porcelain`.
 * [por que] Formato `XY ruta`: X = indice (staged), Y = arbol de trabajo
 * (unstaged); '??' = untracked; 'R' renombra 'viejo -> nuevo' (cuenta 1). */
function contarCambios(status: string): EstadoGit['cambios'] {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const linea of status.split('\n')) {
    if (!linea) continue;
    if (linea.startsWith('??')) {
      untracked++;
      continue;
    }
    const x = linea[0];
    const y = linea[1] ?? ' ';
    if (x !== ' ') staged++;
    if (y !== ' ') unstaged++;
  }
  return { staged, unstaged, untracked };
}

/* Worktrees registrados cuyo directorio ya no existe o cuya metadata gitdir
 * apunta a una ubicacion inexistente (git los marcaria 'prunable').
 * [por que] `git worktree prune` no es necesario para detectar: se lee la
 * lista porcelana y se valida la existencia real; el escaner SOLO reporta. */
function worktreesOrfanos(ruta: string, puerto: PuertoGit): string[] {
  /* [por que] Sin `<gitdir>/worktrees/` no hay worktrees secundarios, asi que no
   * puede haber huerfanos: se evita un proceso git por repo (~43 ms medidos). */
  const gitdir = gitdirDe(ruta);
  if (gitdir && !existsSync(join(commondirDe(gitdir), 'worktrees'))) return [];
  const salida = puerto.git(ruta, ['worktree', 'list', '--porcelain']);
  if (!salida) return [];
  const raizNorm = normalize(ruta).toLowerCase();
  const orfanos: string[] = [];
  for (const bloque of salida.split('\n\n')) {
    const m = bloque.match(/^worktree (.+)$/m);
    if (!m) continue;
    const wt = m[1].trim();
    /* La raiz del repo es el worktree principal: siempre existe. [por que]
     * git devuelve rutas con '/' mientras ruta puede llegar con '\'; se
     * normalizan ambas antes de comparar (Windows es case-insensitive). */
    if (normalize(wt).toLowerCase() === raizNorm) continue;
    if (!existsSync(wt)) {
      orfanos.push(wt);
      continue;
    }
    /* Si .git es un directorio, es un repo normal listado como worktree
     * principal (caso worktree secundario viendo al principal): NO es huerfano. */
    try {
      const stat = lstatSync(join(wt, '.git'));
      if (stat.isDirectory()) continue;
    } catch {
      /* sin .git -> huerfano */
      orfanos.push(wt);
      continue;
    }
    /* .git es archivo (worktree): huerfano si su gitdir apunta a algo inexistente. */
    try {
      const gitfile = readFileSync(join(wt, '.git'), 'utf8');
      const d = gitfile.match(/gitdir:\s*(.+)/);
      if (d && !existsSync(d[1].trim())) orfanos.push(wt);
    } catch {
      /* sin gitdir legible -> no es worktree valido */
      orfanos.push(wt);
    }
  }
  return orfanos;
}

function leerSubmodulos(ruta: string): string[] {
  const gitmodules = join(ruta, '.gitmodules');
  if (!existsSync(gitmodules)) return [];
  const contenido = readFileSync(gitmodules, 'utf8');
  const submodulos: string[] = [];
  const re = /\[submodule\s+"([^"]+)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenido)) !== null) {
    submodulos.push(m[1]);
  }
  return submodulos;
}

/* Limites del detalle de sync: bastan para decidir que subir/traer sin
 * inundar la tab (el plan 289A-6 pide listas acotadas con "+N mas"). */
const MAX_COMMITS_LADO = 50;
export const MAX_ARCHIVOS_LOCALES = 200;

/* Parsea `git log --format=%H%x09%ci%x09%s` en resumenes de una linea. */
function parsearCommits(salida: string | null): CommitResumen[] {
  if (!salida) return [];
  const commits: CommitResumen[] = [];
  for (const linea of salida.split('\n')) {
    if (!linea) continue;
    const [hash, fecha, ...resto] = linea.split('\t');
    if (!hash) continue;
    commits.push({ hash, fecha: fecha ?? '', mensaje: resto.join('\t') });
  }
  return commits;
}

/* Parsea `N files changed[, M insertions(+)][, K deletions(-)]` del
 * --shortstat. [por que] El shortstat es estable entre versiones de git y
 * evita recorrer el diff completo solo para la cabecera plegable. */
function parsearShortstat(salida: string | null): { archivos: number; inserciones: number; borrados: number } {
  const base = { archivos: 0, inserciones: 0, borrados: 0 };
  if (!salida) return base;
  const mArch = salida.match(/(\d+) files? changed/);
  const mIns = salida.match(/(\d+) insertions?\(\+\)/);
  const mDel = salida.match(/(\d+) deletions?\(-\)/);
  return {
    archivos: mArch ? Number(mArch[1]) : 0,
    inserciones: mIns ? Number(mIns[1]) : 0,
    borrados: mDel ? Number(mDel[1]) : 0,
  };
}

/* Un lado del sync: lista de commits + stat agregado del rango. */
function leerLado(ruta: string, rangoLog: string, rangoDiff: string, puerto: PuertoGit): LadoSync {
  const commits = parsearCommits(
    puerto.git(ruta, ['log', rangoLog, `--max-count=${MAX_COMMITS_LADO}`, '--format=%H%x09%ci%x09%s']),
  );
  const stat = parsearShortstat(puerto.git(ruta, ['diff', '--shortstat', rangoDiff]));
  return { commits, ...stat };
}

/* Estado de un archivo desde las columnas XY del porcelain (misma lectura
 * que contarCambios: '??' = untracked; X = indice, Y = trabajo). */
function estadoArchivo(x: string, y: string): ArchivoLocal['estado'] {
  const enIndice = x !== ' ' && x !== '?';
  const enTrabajo = y !== ' ' && y !== '?';
  if (x === '?' || y === '?') return 'untracked';
  if (enIndice && enTrabajo) return 'mixto';
  if (enIndice) return 'staged';
  return 'unstaged';
}

/* Detalle de sincronizacion de un repo para la tab repos (289A-6): que se
 * va a subir (upstream..HEAD), que hay por traer (HEAD..upstream) y que hay
 * sin commitear (porcelain). Solo lectura: log/diff/status, sin fetch. */
export function detalleSync(ruta: string, puerto: PuertoGit = PUERTO_GIT): Omit<DetalleRepoSync, 'clave'> {
  const upstream = puerto.git(ruta, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstream === null) {
    const locales = leerLocales(ruta, puerto);
    return {
      sinUpstream: true,
      salientes: { commits: [], archivos: 0, inserciones: 0, borrados: 0 },
      entrantes: { commits: [], archivos: 0, inserciones: 0, borrados: 0 },
      locales,
    };
  }
  return {
    sinUpstream: false,
    salientes: leerLado(ruta, `${upstream}..HEAD`, `${upstream}...HEAD`, puerto),
    entrantes: leerLado(ruta, `HEAD..${upstream}`, `HEAD...${upstream}`, puerto),
    locales: leerLocales(ruta, puerto),
  };
}

function leerLocales(ruta: string, puerto: PuertoGit): DetalleRepoSync['locales'] {
  const status = puerto.git(ruta, ['status', '--porcelain']) ?? '';
  const archivos: ArchivoLocal[] = [];
  for (const linea of status.split('\n')) {
    if (!linea || archivos.length >= MAX_ARCHIVOS_LOCALES) break;
    if (linea.startsWith('??')) {
      archivos.push({ ruta: linea.slice(3), estado: 'untracked' });
      continue;
    }
    /* Renombros 'R  viejo -> nuevo': mostrar el destino (lo que se sube). */
    const cruda = linea.slice(3);
    const rutaMostrar = cruda.includes(' -> ') ? cruda.split(' -> ').at(-1)! : cruda;
    archivos.push({ ruta: rutaMostrar, estado: estadoArchivo(linea[0] ?? ' ', linea[1] ?? ' ') });
  }
  const totalLineas = status.split('\n').filter(Boolean).length;
  return { archivos, truncado: totalLineas > archivos.length };
}
