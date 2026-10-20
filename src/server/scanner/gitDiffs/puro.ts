/* Parte pura de los diffs por archivo (scanner/gitDiffs.ts): interpreta el porcelain y
 * recorta los diffs, sin lanzar git. [por que] Separada de gitDiffs.ts (19AA-13) para
 * probarla con texto fijo, sin repositorio ni proceso. */
import type { EntradaCambio } from '../../../shared/types.js';

/* Límites del lateral de cambios por archivo (299A-4, copiado de proyecto-ejemplo
 * core/src/git.rs): diffs acotados en bytes y untracked acotados en archivos. */
export const MAX_BYTES_DIFF = 256 * 1024;
export const MAX_UNTRACKED_DIFF = 20;

/* Solo componentes normales: el path viene del porcelain pero el --no-index lo convierte
 * en argumento de proceso (defensa en profundidad, como el `ruta_valida` de harness:
 * sin `..`, sin absolutos, sin vacíos). */
export function rutaDiffSegura(ruta: string): boolean {
  if (!ruta || ruta.startsWith('/') || /^[a-zA-Z]:/.test(ruta)) return false;
  return ruta
    .split('/')
    .every((parte) => parte !== '' && parte !== '.' && parte !== '..');
}

export interface EstadoPorcelain {
  entradas: EntradaCambio[];
  /* Archivos sin seguimiento a los que hay que generar diff; los directorios no entran. */
  sinRastrear: string[];
  truncado: boolean;
}

/* Interpreta `git status --porcelain` hasta `tope` entradas. */
export function leerPorcelain(status: string, tope: number): EstadoPorcelain {
  const entradas: EntradaCambio[] = [];
  const sinRastrear: string[] = [];
  for (const linea of status.split('\n')) {
    if (!linea || entradas.length >= tope) break;
    if (linea.startsWith('??')) {
      const r = linea.slice(3);
      entradas.push({ estado: '??', ruta: r });
      /* Directorios untracked (terminan en /): sin diff individual, como en harness
       * (la fila muestra "sin diff disponible"). */
      if (!r.endsWith('/')) sinRastrear.push(r);
      continue;
    }
    /* Renombros 'R  viejo -> nuevo': mostrar el destino (lo que se revisa). */
    const cruda = linea.slice(3);
    const rutaMostrar = cruda.includes(' -> ') ? cruda.split(' -> ').at(-1)! : cruda;
    entradas.push({ estado: `${linea[0] ?? ' '}${linea[1] ?? ' '}`, ruta: rutaMostrar });
  }
  const truncado = status.split('\n').filter(Boolean).length > entradas.length;
  return { entradas, sinRastrear, truncado };
}

/* Recorta un texto a `max` caracteres e indica si hubo corte. */
export function recortar(texto: string, max: number): { texto: string; cortado: boolean } {
  return texto.length > max ? { texto: texto.slice(0, max), cortado: true } : { texto, cortado: false };
}
