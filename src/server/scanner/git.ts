/* Escaner Git: lee estado de un repositorio usando solo `git` CLI + filesystem.
 * [por que] Sin libgit2 ni binarios nativos: funciona en cualquier entorno y es
 * el mismo enfoque ligero del resto del proyecto. */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { ArchivoLocal, CommitResumen, DetalleRepoSync, EstadoGit, LadoSync } from '../../shared/types.js';

export interface InfoGit {
  esRepo: boolean;
  esWorktree: boolean;
  padre: string | null;
}

/** Detecta si una carpeta es repo Git (carpeta .git) o worktree (archivo .git). */
export function detectarGit(ruta: string): InfoGit {
  const gitPath = join(ruta, '.git');
  if (existsSync(gitPath)) {
    /* [por que] lstatSync NO sigue symlinks: un symlink roto (destino inexistente)
     * hace que statSync lance ENOENT y el repo se pierda (caso GLORYINSPECTOR). */
    const stat = lstatOrNull(gitPath);
    if (stat?.isDirectory()) {
      return { esRepo: true, esWorktree: false, padre: null };
    }
    if (stat?.isFile() || stat?.isSymbolicLink()) {
      /* worktree: .git es un archivo con "gitdir: <ruta>" */
      try {
        const contenido = readFileSync(gitPath, 'utf8');
        const m = contenido.match(/gitdir:\s*(.+)/);
        if (m) {
          return { esRepo: true, esWorktree: true, padre: m[1].trim() };
        }
      } catch {
        /* sin lectura -> comprobar con git directamente */
      }
    }
  }
  /* [por que] ultimo recurso: si git reconoce la carpeta, es repo aunque el
   * .git sea un symlink/junction que el filesystem no resuelve bien. */
  if (git(ruta, ['rev-parse', '--is-inside-work-tree']) === 'true') {
    return { esRepo: true, esWorktree: false, padre: null };
  }
  return { esRepo: false, esWorktree: false, padre: null };
}

function lstatOrNull(ruta: string) {
  try {
    return lstatSync(ruta);
  } catch {
    return null;
  }
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
    return execFileSync('git', args, {
      cwd: ruta,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    }).trimEnd();
  } catch {
    return null;
  }
}

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

/** Estado completo de un repo: rama, remoto, dirty, ahead/behind, submodulos, ultimo commit. */
export function estadoGit(ruta: string): EstadoGit | null {
  /* [por que] `git rev-parse --abbrev-ref HEAD` devuelve "HEAD" tanto en detached
   * como en repo vacio (unborn, sin commits). Distinguir con symbolic-ref +
   * rev-parse --verify HEAD: si no hay commits, reportar la rama por defecto
   * como "(sin commits)" en vez de DETACHED, que seria falso. */
  let rama: string;
  let esDetached = false;
  const ramaRef = git(ruta, ['symbolic-ref', '--short', 'HEAD']);
  if (ramaRef !== null) {
    rama = ramaRef;
  } else if (git(ruta, ['rev-parse', '--verify', 'HEAD']) !== null) {
    esDetached = true;
    rama = 'DETACHED';
  } else {
    rama = `${ramaPrimariaDeclarada(ruta)} (sin commits)`;
  }

  const remoto = git(ruta, ['remote', 'get-url', 'origin']);
  const status = git(ruta, ['status', '--porcelain']) ?? '';
  const dirty = status.length > 0;
  const cambios = contarCambios(status);

  /* ahead/behind contra el upstream de la rama actual */
  let ahead = 0;
  let behind = 0;
  const revList = git(ruta, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (revList) {
    const partes = revList.split(/\s+/);
    if (partes.length === 2) {
      ahead = Number(partes[0]) || 0;
      behind = Number(partes[1]) || 0;
    }
  }

  const submodulos = leerSubmodulos(ruta);
  const ultimoCommit = git(ruta, ['log', '-1', '--format=%H%x09%ci%x09%s']);
  let commit: EstadoGit['ultimoCommit'] = null;
  if (ultimoCommit) {
    const [hash, fecha, ...resto] = ultimoCommit.split('\t');
    commit = { hash, fecha, mensaje: resto.join('\t') };
  }

  return {
    rama: esDetached ? 'DETACHED' : rama,
    remoto,
    ramaPrimaria: ramaPrimariaDeclarada(ruta),
    dirty,
    ahead,
    behind,
    cambios,
    worktreesOrfanos: worktreesOrfanos(ruta),
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
function worktreesOrfanos(ruta: string): string[] {
  const salida = git(ruta, ['worktree', 'list', '--porcelain']);
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
function leerLado(ruta: string, rangoLog: string, rangoDiff: string): LadoSync {
  const commits = parsearCommits(
    git(ruta, ['log', rangoLog, `--max-count=${MAX_COMMITS_LADO}`, '--format=%H%x09%ci%x09%s']),
  );
  const stat = parsearShortstat(git(ruta, ['diff', '--shortstat', rangoDiff]));
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
export function detalleSync(ruta: string): Omit<DetalleRepoSync, 'clave'> {
  const upstream = git(ruta, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstream === null) {
    const locales = leerLocales(ruta);
    return {
      sinUpstream: true,
      salientes: { commits: [], archivos: 0, inserciones: 0, borrados: 0 },
      entrantes: { commits: [], archivos: 0, inserciones: 0, borrados: 0 },
      locales,
    };
  }
  return {
    sinUpstream: false,
    salientes: leerLado(ruta, `${upstream}..HEAD`, `${upstream}...HEAD`),
    entrantes: leerLado(ruta, `HEAD..${upstream}`, `HEAD...${upstream}`),
    locales: leerLocales(ruta),
  };
}

function leerLocales(ruta: string): DetalleRepoSync['locales'] {
  const status = git(ruta, ['status', '--porcelain']) ?? '';
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
