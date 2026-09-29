/* Fracciones de ancho de una fila de Cajas hermanas, persistidas por fila.
 * [por que] El usuario pidio cambiar los anchos de los paneles como en el
 * mapa (no solo mirarlos): el gesto ya era central (ui/Resizer.tsx) pero el
 * estado estaba cableado solo al mapa (useLayoutV2) y las filas de Cajas
 * usaban flex fijos por tab. Este hook es el estado generico que le faltaba:
 * FilaCajas lo usa en las 6 tabs; el mapa sigue con su useLayoutV2 (anchos
 * absolutos con paneles que se ocultan, otro modelo).
 * [por que] Fracciones (no px): sobreviven a cambios de ventana; con ids
 * estables la caja que se abre/cierra no pierde el reparto de las demas. */
import { useEffect, useState } from 'react';
import { logger } from '../../shared/logger.js';
import { MIN_ANCHO } from '../useLayoutV2.js';

function claveFila(fila: string): string {
  return `workspaceManager:fila:${fila}`;
}

function leerGuardadas(fila: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(claveFila(fila));
    if (!raw) return {};
    const d = JSON.parse(raw) as Record<string, unknown>;
    const limpias: Record<string, number> = {};
    for (const [id, v] of Object.entries(d)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) limpias[id] = v;
    }
    return limpias;
  } catch (err) {
    logger.warn('no se pudieron leer los anchos de la fila:', err);
    return {};
  }
}

export function useAnchosFila(fila: string, ids: string[], defectos: number[]) {
  /* Defecto por hija (si falta, 1): normalizado a fracciones. */
  const defectoNorm = ids.map((_, i) => defectos[i] ?? 1);
  const sumaDefecto = defectoNorm.reduce((a, b) => a + b, 0) || 1;

  const [guardadas, setGuardadas] = useState<Record<string, number>>(() => leerGuardadas(fila));

  /* Persiste en cada cambio para sobrevivir a recargas (igual que el mapa). */
  useEffect(() => {
    try {
      localStorage.setItem(claveFila(fila), JSON.stringify(guardadas));
    } catch (err) {
      logger.warn('no se pudieron guardar los anchos de la fila:', err);
    }
  }, [fila, guardadas]);

  /* Fracciones a renderizar: las guardadas mandan; la hija nueva toma su
   * parte del defecto; todo se renormaliza a suma 1. */
  function brutos(): number[] {
    return ids.map((id, i) => {
      const g = guardadas[id];
      return typeof g === 'number' ? g : defectoNorm[i] / sumaDefecto;
    });
  }
  const suma = brutos().reduce((a, b) => a + b, 0) || 1;
  const fracs = brutos().map((b) => b / suma);

  /* Mueve dx pixeles de la hija i+1 a la i (anchoFila = ancho medido de la
   * fila). Tope inferior compartido con el mapa: MIN_ANCHO por caja. */
  function ajustar(anchoFila: number, i: number, dx: number) {
    if (!Number.isFinite(anchoFila) || anchoFila <= 0) return;
    if (i < 0 || i + 1 >= ids.length) return;
    const min = MIN_ANCHO / anchoFila;
    setGuardadas((prev) => {
      const base = ids.map((id, k) => {
        const g = prev[id];
        return typeof g === 'number' ? g : defectoNorm[k] / sumaDefecto;
      });
      const total = base.reduce((a, b) => a + b, 0) || 1;
      const n = base.map((b) => b / total);
      const par = n[i] + n[i + 1];
      if (par < min * 2) return prev;
      const ni = Math.min(par - min, Math.max(min, n[i] + dx / anchoFila));
      if (ni === n[i]) return prev;
      return { ...prev, [ids[i]]: ni, [ids[i + 1]]: par - ni };
    });
  }

  return { fracs, ajustar };
}
