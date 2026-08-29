/* Estado de un proyecto para las vistas v2 (mapa y lista).
 * [por que] Compartido entre el mapa y la lista para que ambas clasifiquen y
 * ordenen igual: el mapa ordena repo < dirty < gate < carpeta y el panel de
 * lista reutiliza ese mismo orden. */
import type { Proyecto } from '../shared/types.js';

export type EstadoTile = 'repo' | 'dirty' | 'gate' | 'carpeta';

export const PESO_ESTADO: Record<EstadoTile, number> = {
  repo: 0,
  dirty: 1,
  gate: 2,
  carpeta: 3,
};

export function estadoProyecto(p: Proyecto): EstadoTile {
  if (!p.esGit) return 'carpeta';
  if (p.git?.dirty) return 'dirty';
  if (p.gate?.declarado) return 'gate';
  return 'repo';
}
