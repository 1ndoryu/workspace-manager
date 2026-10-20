/* Diffs por archivo para el lateral de la tab repos: detalleArchivos.
 * [por que] [299A-11] Bloque E: sale de scanner/git.js (329 líneas
 * efectivas); la detección/estado/sync quedan en git.js y este módulo
 * importa de allí el helper `git`. [19AA-13] La interpretación del porcelain y el
 * recorte de diffs viven en gitDiffs/puro.ts; aquí solo se lanza git, por el puerto. */
import { execFileSync } from 'node:child_process';
import { MAX_ARCHIVOS_LOCALES, opcionesGit, PUERTO_GIT, type PuertoGit } from './git.js';
import { BIN_GIT } from '../plataforma/sistema/binarios.js';
import type { ArchivosRepo } from '../../shared/types.js';
import { leerPorcelain, MAX_BYTES_DIFF, MAX_UNTRACKED_DIFF, recortar, rutaDiffSegura } from './gitDiffs/puro.js';

/* git con codigo de salida: el `diff --no-index` devuelve 1 si hay
 * diferencias (no es error); otro codigo o excepcion = fallo real. [por que] El puerto
 * devuelve null en cualquier código distinto de 0, y aquí hace falta el stdout del 1. */
function gitCodigo(ruta: string, args: string[]): { salida: string; codigo: number } | null {
  try {
    const salida = execFileSync(BIN_GIT, args, opcionesGit(ruta)).trimEnd();
    return { salida, codigo: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: unknown };
    if (err.status === 1 && typeof err.stdout === 'string') {
      return { salida: err.stdout.trimEnd(), codigo: 1 };
    }
    return null;
  }
}

/* Archivos con cambios + diffs por grupo para el lateral de la tab repos
 * (299A-4): entradas con el estado XY crudo del porcelain, `diff --cached`
 * (staged), `diff` (unstaged) y untracked como `diff --no-index` contra
 * /dev/null. Solo lectura, sin fetch/stage. `puerto` permite inyectar la salida de git. */
export function detalleArchivos(ruta: string, puerto: PuertoGit = PUERTO_GIT): Omit<ArchivosRepo, 'clave'> {
  const status = puerto.git(ruta, ['status', '--porcelain']) ?? '';
  const { entradas, sinRastrear, truncado: cortadoEntradas } = leerPorcelain(status, MAX_ARCHIVOS_LOCALES);
  let truncado = cortadoEntradas;

  const staged = recortar(puerto.git(ruta, ['diff', '--no-ext-diff', '--unified=3', '--cached']) ?? '', MAX_BYTES_DIFF);
  let diffStaged = staged.texto;
  if (staged.cortado) truncado = true;

  const unstaged = recortar(
    puerto.git(ruta, ['diff', '--no-ext-diff', '--unified=3']) ?? '',
    MAX_BYTES_DIFF - diffStaged.length,
  );
  let diffUnstaged = unstaged.texto;
  if (unstaged.cortado) truncado = true;

  /* Contenido de untracked anexado al diff unstaged (como harness): cada
   * archivo es un diff completo contra /dev/null. */
  let usados = diffStaged.length + diffUnstaged.length;
  let servidos = 0;
  for (const r of sinRastrear) {
    if (servidos >= MAX_UNTRACKED_DIFF || usados >= MAX_BYTES_DIFF) {
      truncado = true;
      break;
    }
    if (!rutaDiffSegura(r)) continue;
    const d = gitCodigo(ruta, ['diff', '--no-ext-diff', '--no-index', '--unified=3', '--', '/dev/null', r]);
    if (!d || (d.codigo !== 0 && d.codigo !== 1)) {
      truncado = true;
      continue;
    }
    servidos++;
    const hueco = MAX_BYTES_DIFF - usados;
    if (d.salida.length > hueco) {
      diffUnstaged += `\n${d.salida.slice(0, hueco)}`;
      truncado = true;
      break;
    }
    diffUnstaged += `\n${d.salida}`;
    usados += d.salida.length + 1;
  }
  return { entradas, diffStaged, diffUnstaged, truncado };
}
