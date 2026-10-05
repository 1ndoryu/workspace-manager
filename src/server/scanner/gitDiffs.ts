/* Diffs por archivo para el lateral de la tab repos: detalleArchivos.
 * [por que] [299A-11] Bloque E: sale de scanner/git.js (329 líneas
 * efectivas); la detección/estado/sync quedan en git.js y este módulo
 * importa de allí el helper `git`. */
import { execFileSync } from 'node:child_process';
import { git, MAX_ARCHIVOS_LOCALES } from './git.js';
import type { ArchivosRepo, EntradaCambio } from '../../shared/types.js';

/* Limites del lateral de cambios por archivo (299A-4, copiado de
 * glory-harness core/src/git.rs): diffs acotados en bytes y untracked
 * acotados en archivos; el --no-index devuelve codigo 1 cuando hay diff. */
const MAX_BYTES_DIFF = 256 * 1024;
const MAX_UNTRACKED_DIFF = 20;

/* git con codigo de salida: el `diff --no-index` devuelve 1 si hay
 * diferencias (no es error); otro codigo o excepcion = fallo real. */
function gitCodigo(ruta: string, args: string[]): { salida: string; codigo: number } | null {
  try {
    const salida = execFileSync('git', args, {
      cwd: ruta,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      windowsHide: true,
    }).trimEnd();
    return { salida, codigo: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: unknown };
    if (err.status === 1 && typeof err.stdout === 'string') {
      return { salida: err.stdout.trimEnd(), codigo: 1 };
    }
    return null;
  }
}

/* Solo componentes normales: el path viene del porcelain pero el --no-index
 * lo convierte en argumento de proceso (defensa en profundidad, como el
 * `ruta_valida` de harness: sin `..`, sin absolutos, sin vacios). */
function rutaDiffSegura(ruta: string): boolean {
  if (!ruta || ruta.startsWith('/') || /^[a-zA-Z]:/.test(ruta)) return false;
  return ruta
    .split('/')
    .every((parte) => parte !== '' && parte !== '.' && parte !== '..');
}

/* Archivos con cambios + diffs por grupo para el lateral de la tab repos
 * (299A-4): entradas con el estado XY crudo del porcelain, `diff --cached`
 * (staged), `diff` (unstaged) y untracked como `diff --no-index` contra
 * /dev/null. Solo lectura, sin fetch/stage. */
export function detalleArchivos(ruta: string): Omit<ArchivosRepo, 'clave'> {
  const status = git(ruta, ['status', '--porcelain']) ?? '';
  const entradas: EntradaCambio[] = [];
  const sinRastrear: string[] = [];
  for (const linea of status.split('\n')) {
    if (!linea || entradas.length >= MAX_ARCHIVOS_LOCALES) break;
    if (linea.startsWith('??')) {
      const r = linea.slice(3);
      entradas.push({ estado: '??', ruta: r });
      /* Directorios untracked (terminan en /): sin diff individual, como
       * en harness (la fila muestra "sin diff disponible"). */
      if (!r.endsWith('/')) sinRastrear.push(r);
      continue;
    }
    /* Renombros 'R  viejo -> nuevo': mostrar el destino (lo que se revisa). */
    const cruda = linea.slice(3);
    const rutaMostrar = cruda.includes(' -> ') ? cruda.split(' -> ').at(-1)! : cruda;
    entradas.push({ estado: `${linea[0] ?? ' '}${linea[1] ?? ' '}`, ruta: rutaMostrar });
  }
  let truncado = status.split('\n').filter(Boolean).length > entradas.length;

  let diffStaged = git(ruta, ['diff', '--no-ext-diff', '--unified=3', '--cached']) ?? '';
  if (diffStaged.length > MAX_BYTES_DIFF) {
    diffStaged = diffStaged.slice(0, MAX_BYTES_DIFF);
    truncado = true;
  }
  let diffUnstaged = git(ruta, ['diff', '--no-ext-diff', '--unified=3']) ?? '';
  let resto = MAX_BYTES_DIFF - diffStaged.length;
  if (diffUnstaged.length > resto) {
    diffUnstaged = diffUnstaged.slice(0, resto);
    truncado = true;
  }

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
    const d = gitCodigo(ruta, [
      'diff',
      '--no-ext-diff',
      '--no-index',
      '--unified=3',
      '--',
      '/dev/null',
      r,
    ]);
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
