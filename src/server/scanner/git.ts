/* Escaner Git: lee estado de un repositorio usando solo `git` CLI + filesystem.
 * [por que] Sin libgit2 ni binarios nativos: funciona en cualquier entorno y es
 * el mismo enfoque ligero del resto del proyecto. */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EstadoGit } from '../../shared/types.js';

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

/** Ejecuta git con args en un cwd, devolviendo salida limpia o null si falla. */
function git(ruta: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: ruta,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();
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
    submodulos,
    ultimoCommit: commit,
  };
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
