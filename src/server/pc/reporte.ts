/* Lectura del último análisis guardado. Módulo hoja: lo usan el análisis (scan.ts)
 * y la limpieza (limpiezaBase.ts) sin que la limpieza dependa del scan.
 * [por que] Antes limpiezaBase importaba leerReporte de scan.js: una dependencia
 * de la limpieza hacia el análisis que no tiene más razón que el sitio del código. */
import { existsSync, readFileSync } from 'node:fs';
import { esDelicada, rutaReporte } from './ejecucion.js';
import type { EntradaPc, ReportePc } from './ejecucion.js';
import { appsAjenas, leerRegistroArea } from '../registro.js';

/* Apps ajenas al área, o vacío si el registro no se puede leer: sin registro no
 * hay exención, que es lo conservador (así no se deja sin limpiar una carpeta
 * por un nombre que nadie declaró). */
export function ajenasDelArea(): string[] {
  try {
    return appsAjenas(leerRegistroArea());
  } catch {
    return [];
  }
}

/* Último análisis guardado (rehidrata la tab al recargar sin re-escanear).
 * Null si aún no se analizó. [por que] `delicada` se recalcula al leer en vez de
 * fiarse de lo guardado: el reporte puede ser de antes de cambiar el registro, y
 * una caché no debe servir una política vieja (ni obligar a re-escanear). */
export function leerReporte(): ReportePc | null {
  try {
    const f = rutaReporte();
    if (!existsSync(f)) return null;
    const r = JSON.parse(readFileSync(f, 'utf8')) as Partial<ReportePc>;
    if (!Array.isArray(r.entradas)) return null;
    const ajenos = ajenasDelArea();
    return {
      entradas: (r.entradas as EntradaPc[]).map((e) => ({ ...e, delicada: esDelicada(e, ajenos) })),
      totalBytes: typeof r.totalBytes === 'number' ? r.totalBytes : 0,
      medidoEn: typeof r.medidoEn === 'string' ? r.medidoEn : '',
      versionBinario: typeof r.versionBinario === 'string' ? r.versionBinario : null,
    };
  } catch {
    return null;
  }
}
