/* Constantes y puras del historial VPS por despliegue (07AA-4).
 * [por que] Los topes y la fusión deben ser idénticos en frente y servidor:
 * una sola definición compartida en vez de dos copias que deriven. Las
 * muestras son tuplas [t, cpuPct, memMiB] con t en ms epoch. */
export const HIST_MAX_MUESTRAS = 2000;
export const HIST_RETENCION_MS = 7 * 24 * 60 * 60 * 1000;
export const HIST_INTERVALO_MS = 30_000;

export type MuestraHistorial = [t: number, cpuPct: number, memMiB: number];

/* Clave de serie: la misma que la tabla (`sitio:<nombre>`, `infra` sin sitio). */
export function claveSitio(nombre: string | null | undefined): string {
  return nombre ? `sitio:${nombre}` : 'infra';
}

/* Base temporal común (07AA-4): el ts del snapshot de pulse viene en ms epoch
 * (contrato F0 calibrado en `glory-pulse/schema/ejemplo.json`); si está sano
 * manda él —servidor y frente estampan lo mismo y el dedupe por t es exacto—.
 * Si no, reloj local (fail-open: nunca se pierde la muestra). */
export function normalizarTs(ts: unknown, ahora: number): number {
  if (
    typeof ts === 'number' &&
    Number.isFinite(ts) &&
    ts > 1_000_000_000_000 &&
    ts <= ahora + 60_000
  ) {
    return Math.floor(ts);
  }
  return ahora;
}

export function esMuestra(v: unknown): v is MuestraHistorial {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/* Fusión base + colas (07AA-4): concatena en orden de frescura (la última
 * lista gana ante el mismo t), ordena por t y recorta a la cola de MAX. */
export function fusionarSeries(...listas: MuestraHistorial[][]): MuestraHistorial[] {
  const porT = new Map<number, MuestraHistorial>();
  for (const lista of listas) {
    for (const m of lista) {
      if (esMuestra(m)) porT.set(m[0], m);
    }
  }
  return [...porT.values()].sort((a, b) => a[0] - b[0]).slice(-HIST_MAX_MUESTRAS);
}
