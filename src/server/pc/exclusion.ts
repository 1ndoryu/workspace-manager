/* Exclusión mutua entre el análisis (scan) y el borrado (limpieza) del papel `limpiador`.
 * [por que] Módulo hoja: no importa a ninguno de los dos. Antes cada uno guardaba su
 * bandera y exportaba el predicado del otro, y eso formaba un ciclo scan ↔ limpieza.
 * Ahora ambos dependen de aquí y no entre sí. Quien arranca o termina un trabajo
 * avisa con `marcarScan` / `marcarLimpieza`, junto al cambio de su estado. */
let scanActivo = false;
let limpiezaActiva = false;

export function marcarScan(activo: boolean): void {
  scanActivo = activo;
}

export function marcarLimpieza(activo: boolean): void {
  limpiezaActiva = activo;
}

export function hayScanEnCurso(): boolean {
  return scanActivo;
}

export function hayLimpiezaEnCurso(): boolean {
  return limpiezaActiva;
}
