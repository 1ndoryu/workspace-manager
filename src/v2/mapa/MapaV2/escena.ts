/* Escena del mapa v2: orden de pintado, rango de celdas ocupadas y cajas sin línea.
 * [por que] Funciones puras sobre la disposición: sin DOM ni estado, para poder probarlas. */
import type { Colocado, Enlace, Hub } from '../geometria/disposicion.js';

export type ItemEscena =
  | { tipo: 'proyecto'; col: number; fila: number; p: Colocado['p'] }
  | { tipo: 'hub'; col: number; fila: number; h: Hub };

export interface RangoCeldas {
  minCol: number;
  maxCol: number;
  minFila: number;
  maxFila: number;
}

/* Orden de pintado iso: lo más lejano (col+fila menor) primero, para que las cajas cercanas
 * tapen a las lejanas. */
export function escenaOrdenada(colocados: Colocado[], hubs: Hub[]): ItemEscena[] {
  const items: ItemEscena[] = [
    ...colocados.map((c): ItemEscena => ({ tipo: 'proyecto', col: c.col, fila: c.fila, p: c.p })),
    ...hubs.map((h): ItemEscena => ({ tipo: 'hub', col: h.col, fila: h.fila, h })),
  ];
  return items.sort((a, b) => a.col + a.fila - (b.col + b.fila) || a.col - b.col);
}

/* Rango de celdas ocupadas por cajas y nodos (para extender la cuadrícula). Null sin escena. */
export function calcularRango(escena: ItemEscena[]): RangoCeldas | null {
  if (escena.length === 0) return null;
  const cols = escena.map((g) => g.col);
  const filas = escena.map((g) => g.fila);
  return {
    minCol: Math.min(...cols),
    maxCol: Math.max(...cols),
    minFila: Math.min(...filas),
    maxFila: Math.max(...filas),
  };
}

/* Claves sin ninguna línea: no corren en ningún sitio y el mapa las atenúa, igual que su
 * cuadro en la lista de proyectos. */
export function libresDe(colocados: Colocado[], enlaces: Enlace[]): Set<string> {
  const conLinea = new Set(enlaces.map((e) => e.clave));
  return new Set(colocados.filter((c) => !conLinea.has(c.p.clave)).map((c) => c.p.clave));
}
