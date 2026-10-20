/* Parseo puro de la salida de git: cabecera de `status`, cambios, commits, shortstat y estado de
 * archivo. [por que aparte] Sin procesos ni disco: se prueba con texto fijo, sin git instalado.
 * git.ts lanza git y le pasa aqui lo que devuelve. */
import type { ArchivoLocal, CommitResumen, EstadoGit } from '../../shared/types.js';

/* Cabecera de `git status --porcelain --branch`: rama, upstream y ahead/behind.
 * [por que] Un solo proceso da lo que antes pedian tres (`symbolic-ref`,
 * `rev-list --left-right` y `status`). Formatos posibles:
 *   `## main...origin/main [ahead 1, behind 2]`   normal con upstream
 *   `## main...origin/main [gone]`               upstream borrado
 *   `## main`                                    sin upstream
 *   `## HEAD (no branch)`                        detached
 *   `## No commits yet on main`                  repo sin commits (unborn) */
export function leerCabeceraStatus(cabecera: string): { rama: string; ahead: number; behind: number } {
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

/* Cuenta cambios locales por tipo desde `git status --porcelain`.
 * [por que] Formato `XY ruta`: X = indice (staged), Y = arbol de trabajo
 * (unstaged); '??' = untracked; 'R' renombra 'viejo -> nuevo' (cuenta 1). */
export function contarCambios(status: string): EstadoGit['cambios'] {
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

/* Parsea `git log --format=%H%x09%ci%x09%s` en resumenes de una linea. */
export function parsearCommits(salida: string | null): CommitResumen[] {
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
export function parsearShortstat(salida: string | null): { archivos: number; inserciones: number; borrados: number } {
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

/* Estado de un archivo desde las columnas XY del porcelain (misma lectura
 * que contarCambios: '??' = untracked; X = indice, Y = trabajo). */
export function estadoArchivo(x: string, y: string): ArchivoLocal['estado'] {
  const enIndice = x !== ' ' && x !== '?';
  const enTrabajo = y !== ' ' && y !== '?';
  if (x === '?' || y === '?') return 'untracked';
  if (enIndice && enTrabajo) return 'mixto';
  if (enIndice) return 'staged';
  return 'unstaged';
}

