/* Persistencia del zoom y la posición del mapa v2 entre recargas.
 * [por que] El usuario pidió que al recargar la página no se pierdan. Se guarda en
 * localStorage (vía el helper compartido, con logger); si no hay nada o el almacenamiento
 * no está disponible, el hook parte del estado por defecto. */
import { guardarJson, leerJson } from '../../shared/vista/storage.js';

export interface EstadoMapaGuardado {
  zoom: number;
  pan: { x: number; y: number };
}

const CLAVE_ESTADO = 'mapaV2:estado';

/* Lee el estado guardado. Null si falta o no tiene la forma esperada (dato corrupto). */
export function estadoGuardado(): EstadoMapaGuardado | null {
  const d = leerJson<Partial<EstadoMapaGuardado>>(
    CLAVE_ESTADO,
    '[mapaV2] no se pudo leer el estado guardado:',
  );
  if (
    !d ||
    typeof d.zoom !== 'number' ||
    !d.pan ||
    typeof d.pan.x !== 'number' ||
    typeof d.pan.y !== 'number'
  ) {
    return null;
  }
  return { zoom: d.zoom, pan: { x: d.pan.x, y: d.pan.y } };
}

export function guardarEstadoMapa(estado: EstadoMapaGuardado): void {
  guardarJson(CLAVE_ESTADO, estado, '[mapaV2] no se pudo guardar el estado del mapa:');
}
