/* Parte pura de guardian/escritura.ts: hash, fin de línea y diferencia por bloque, sin E/S.
 * [por que] Separada (19AA-13) para probarla con texto fijo; escritura.ts la reexporta, así
 * que los importadores no cambian. */
import { createHash } from 'node:crypto';

export type Eol = '\r\n' | '\n';

export function hashDe(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function eolDe(texto: string): Eol {
  return texto.includes('\r\n') ? '\r\n' : '\n';
}

/* Diferencia por bloque: recorta el prefijo y el sufijo comunes. Basta para
 * mostrar un cambio de JSON (pocas líneas cambian) sin dependencia de diff. */
export interface BloqueDiff {
  /* Línea de inicio (1-based) del bloque en el texto original. */
  desde: number;
  quitar: string[];
  poner: string[];
}

export function diffLineas(antes: string, despues: string): BloqueDiff | null {
  const a = antes.split(/\r?\n/u);
  const b = despues.split(/\r?\n/u);
  let prefijo = 0;
  while (prefijo < a.length && prefijo < b.length && a[prefijo] === b[prefijo]) prefijo++;
  let sufijo = 0;
  while (
    sufijo < a.length - prefijo &&
    sufijo < b.length - prefijo &&
    a[a.length - 1 - sufijo] === b[b.length - 1 - sufijo]
  ) sufijo++;
  const quitar = a.slice(prefijo, a.length - sufijo);
  const poner = b.slice(prefijo, b.length - sufijo);
  if (quitar.length === 0 && poner.length === 0) return null;
  return { desde: prefijo + 1, quitar, poner };
}
