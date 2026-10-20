/* Puras del historial de recursos del tablero (20AA-17).
 * [por que] El mismo anillo lo escriben dos sitios —el servidor, que muestrea en
 * segundo plano aunque el tablero esté cerrado, y el navegador, que añade su cola
 * mientras el panel está a la vista— y el panel los mezcla: si la tupla, los topes
 * o el dedupe no fuesen idénticos, la serie saldría con escalones y muestras
 * repetidas. Una definición compartida en vez de dos copias que deriven. */
import { normalizarTs } from './historialVps.js';
import type { VpsAgenteSnapshot } from './tipos/vps.js';

/* Muestra [t, cpuPct, memMiB, rx, tx, blkR, blkW, discoR, discoW]: la misma tupla
 * de 9 que ya guardaba el navegador, así que no hay nada que migrar. */
export type MuestraRecursos = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/* Sector de diskstats = 512 B (el kernel cuenta en sectores de 512 aunque el disco
 * físico use otro tamaño). */
export const SECTOR_BYTES = 512;
export const MAX_MUESTRAS_RECURSOS = 25000;
export const RETENCION_RECURSOS_MS = 7 * 24 * 3600 * 1000;

/* Tabs con anillo propio: ni el servidor ni el panel admiten otra clave. */
export const TABS_RECURSOS = ['vps', 'taller'] as const;
export type TabRecursos = (typeof TABS_RECURSOS)[number];

export function esTabRecursos(v: unknown): v is TabRecursos {
  return typeof v === 'string' && (TABS_RECURSOS as readonly string[]).includes(v);
}

/* Tupla de 9 ya guardada (fichero del servidor o localStorage). Estricta: lo que
 * no encaje se descarta en vez de pintarse a medias. */
export function esMuestraRecursos(v: unknown): v is MuestraRecursos {
  return (
    Array.isArray(v) &&
    v.length === 9 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/* Muestra cruda → tupla de 9, o null si no vale. Acepta las de 7 campos de antes de
 * 0110A-1 (sin IO del host) rellenando dr/dw a cero —eran de contenedor, ya cero:
 * sin distorsión— y descarta lo que esté fuera de la retención. */
export function normalizarMuestraRecursos(v: unknown, corte: number): MuestraRecursos | null {
  if (!Array.isArray(v) || (v.length !== 7 && v.length !== 9)) return null;
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if ((v[0] as number) < corte) return null;
  const nueve = v.length === 7 ? [...(v as number[]), 0, 0] : (v as number[]);
  return nueve as MuestraRecursos;
}

/* Fusión de listas (base del servidor + cola del navegador): por t, la última lista
 * gana —lo vivo pisa lo persistido—, ordenado y recortado a la cola de MAX. */
export function fusionarRecursos(...listas: MuestraRecursos[][]): MuestraRecursos[] {
  const porT = new Map<number, MuestraRecursos>();
  for (const lista of listas) {
    for (const m of lista) {
      if (esMuestraRecursos(m)) porT.set(m[0], m);
    }
  }
  return [...porT.values()].sort((a, b) => a[0] - b[0]).slice(-MAX_MUESTRAS_RECURSOS);
}

function redondear1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* Un snapshot de pulse → una muestra, más el estado de los contadores de disco del
 * host. [por que] El ts sale de `normalizarTs`: servidor y navegador estampan el
 * mismo t para el mismo snapshot y el dedupe al fusionar es exacto. Los contadores de
 * disco se repiten entre muestras mientras pulse no los traiga (plano = sin dato, no
 * cero), por eso el estado entra y sale de aquí. */
export function muestraDeSnapshot(
  snap: VpsAgenteSnapshot,
  discoPrevio: { r: number; w: number } | null,
  ahora: number,
): { muestra: MuestraRecursos; disco: { r: number; w: number } | null } {
  const suma = (campo: (c: VpsAgenteSnapshot['contenedores'][number]) => number) =>
    snap.contenedores.reduce((a, c) => a + campo(c), 0);
  const disco = snap.discoHost
    ? {
        r: snap.discoHost.sectoresLeidos * SECTOR_BYTES,
        w: snap.discoHost.sectoresEscritos * SECTOR_BYTES,
      }
    : discoPrevio;
  const muestra: MuestraRecursos = [
    normalizarTs(snap.ts, ahora),
    redondear1(suma((c) => c.cpuPct)),
    Math.round(suma((c) => c.memMiB)),
    Math.round(suma((c) => c.redRxBytes)),
    Math.round(suma((c) => c.redTxBytes)),
    Math.round(suma((c) => c.blkReadBytes)),
    Math.round(suma((c) => c.blkWriteBytes)),
    Math.round(disco?.r ?? 0),
    Math.round(disco?.w ?? 0),
  ];
  return { muestra, disco };
}
