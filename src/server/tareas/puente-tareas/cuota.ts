/* Espera ante 429 (cuota de TASKS). [por que] Pura: el azar entra por parámetro, así el
 * jitter se fija en los tests sin tocar el generador real. */
const TOPE_ESPERA_CUOTA_MS = 30_000;

/* Espera acotada con jitter (entre la mitad y el total del tope) para que los reintentos
 * no caigan a la vez. `base` es el `retry-after` del servidor; `azar` está en [0, 1). */
export function esperaCuotaMs(base: number, azar: number): number {
  return Math.round(Math.min(base, TOPE_ESPERA_CUOTA_MS) * (0.5 + azar));
}
