/* Anillo de historial por despliegue para el detalle de la tab vps
 * (0110A-3 F2). [por que] El panel global guarda una serie agregada; el
 * detalle por sitio necesita la suya (cpu/mem sumadas por despliegue) sin
 * tocar ese historial. Mismo pacto: tuplas compactas en localStorage, una
 * muestra cada 30 s por sitio con filas vivas (lo detenido no genera
 * dato, conserva lo viejo), tope 2 000 ≈ 16 h, poda >7 días. Puro y
 * testeable (sin React ni DOM): el componente decide cuándo muestrear y
 * guardar. Clave = la de la tabla (`sitio:<nombre>` o `infra`). */
import { guardarJson, leerJson } from '../../shared/storage.js';

/* Muestra como tupla [t, cpuPct, memMiB]: redondeada al muestrear. */
export type MuestraSitio = [number, number, number];

export const CLAVE_HISTORIAL_SITIOS = 'workspaceManager:vps-sitios-historial-v1';
export const MAX_MUESTRAS_SITIO = 2000;
export const INTERVALO_SITIO_MS = 30_000;
const RETENCION_MS = 7 * 24 * 3600 * 1000;
export const MAX_PUNTOS_CHISPA = 120;

export type HistorialSitios = Record<string, MuestraSitio[]>;

function esMuestra(x: unknown): x is MuestraSitio {
  return (
    Array.isArray(x) &&
    x.length === 3 &&
    x.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

export function cargarHistorialSitios(): HistorialSitios {
  const crudo = leerJson<unknown>(CLAVE_HISTORIAL_SITIOS, 'no se pudo leer el historial por sitio:');
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return {};
  const corte = Date.now() - RETENCION_MS;
  const limpio: HistorialSitios = {};
  for (const [clave, lista] of Object.entries(crudo as Record<string, unknown>)) {
    if (typeof clave !== 'string' || clave.length > 80 || !Array.isArray(lista)) continue;
    const muestras = (lista as unknown[]).filter(esMuestra).filter((m) => m[0] >= corte);
    if (muestras.length > 0) limpio[clave] = muestras.slice(-MAX_MUESTRAS_SITIO);
  }
  return limpio;
}

/* Suma por despliegue lo vivo del snapshot (la tabla ya lo agrega igual:
 * cpu/mem sumadas; aquí además se redondea para compactar). */
export function sumarPorSitio(
  filas: { clave: string; cpu: number; mem: number }[],
): Map<string, { cpu: number; mem: number }> {
  const mapa = new Map<string, { cpu: number; mem: number }>();
  for (const f of filas) {
    const previo = mapa.get(f.clave) ?? { cpu: 0, mem: 0 };
    previo.cpu += f.cpu;
    previo.mem += f.mem;
    mapa.set(f.clave, previo);
  }
  for (const v of mapa.values()) {
    v.cpu = Math.round(v.cpu * 10) / 10;
    v.mem = Math.round(v.mem);
  }
  return mapa;
}

/* Añade una muestra por sitio con filas vivas si su última muestra es
 * vieja (≥30 s) o no tiene. Devuelve el historial nuevo y si cambió
 * (para que el llamante guarde solo cuando toca). */
export function muestrearSitios(
  previo: HistorialSitios,
  sumas: Map<string, { cpu: number; mem: number }>,
  ahora: number,
): { siguiente: HistorialSitios; cambio: boolean } {
  let cambio = false;
  const siguiente: HistorialSitios = { ...previo };
  for (const [clave, s] of sumas) {
    const lista = siguiente[clave] ?? [];
    const ultima = lista[lista.length - 1];
    if (ultima && ahora - ultima[0] < INTERVALO_SITIO_MS) continue;
    const nueva: MuestraSitio = [ahora, s.cpu, s.mem];
    siguiente[clave] = [...lista, nueva].slice(-MAX_MUESTRAS_SITIO);
    cambio = true;
  }
  return { siguiente, cambio };
}

/* Serie en rango, diezmada para la chispa (el vivo se pinta encima
 * aparte: aquí solo historia guardada). */
export function serieEnRango(muestras: MuestraSitio[], rangoMs: number, ahora: number): MuestraSitio[] {
  const corte = ahora - rangoMs;
  const enRango = muestras.filter((m) => m[0] >= corte);
  if (enRango.length <= MAX_PUNTOS_CHISPA) return enRango;
  const paso = Math.ceil(enRango.length / MAX_PUNTOS_CHISPA);
  const fuera: MuestraSitio[] = [];
  for (let i = 0; i < enRango.length; i += paso) {
    const m = enRango[i];
    if (m) fuera.push(m);
  }
  const ultima = enRango[enRango.length - 1];
  if (ultima && fuera[fuera.length - 1] !== ultima) fuera.push(ultima);
  return fuera;
}

export function guardarHistorialSitios(h: HistorialSitios): void {
  guardarJson(CLAVE_HISTORIAL_SITIOS, h, 'no se pudo guardar el historial por sitio:');
}
