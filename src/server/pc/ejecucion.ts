/* Base del limpiador-pc: modelo (fases, tipos) + infra compartida (cola
 * serial, rutas en data/pc, escritura atomica).
 * [por que] [299A-11] Bloque E: el analisis vive en scan.js y el borrado en
 * limpieza.js; ambos comparten este modulo (una sola direccion de imports:
 * scan/limpieza → ejecucion, sin ciclos). */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_AREA } from '../http.js';

export type FasePc = 'area' | 'caches' | 'extern' | 'vscode' | 'chrome' | 'tmp';

export const FASES_PC: Record<
  FasePc,
  { scan: string; clean: string; etiqueta: string; descripcion: string; filtro: 'solo_tipo' | 'solo' }
> = {
  area: {
    scan: 'scan',
    clean: 'clean',
    etiqueta: 'área de trabajo',
    descripcion: 'node_modules, target y dist del área',
    filtro: 'solo_tipo',
  },
  caches: {
    scan: 'caches-scan',
    clean: 'caches-clean',
    etiqueta: 'caches del perfil',
    descripcion: 'caches regenerables del perfil',
    filtro: 'solo',
  },
  extern: {
    scan: 'extern-scan',
    clean: 'extern-clean',
    etiqueta: 'herramientas externas',
    descripcion: 'limpia vía comando oficial, nunca borra directo',
    filtro: 'solo',
  },
  vscode: {
    scan: 'vscode-scan',
    clean: 'vscode-clean',
    etiqueta: 'VS Code',
    descripcion: 'basura de Roaming/Code de más de 14 días',
    filtro: 'solo',
  },
  chrome: {
    scan: 'chrome-scan',
    clean: 'chrome-clean',
    etiqueta: 'Chrome',
    descripcion: 'caches de Chrome, nunca toca logins',
    filtro: 'solo',
  },
  tmp: {
    scan: 'tmp-scan',
    clean: 'tmp-clean',
    etiqueta: 'temporales del sistema',
    descripcion: 'C:\\tmp y %TEMP%: targets quietos y sueltos viejos',
    filtro: 'solo_tipo',
  },
};

export const ORDEN_FASES_PC: FasePc[] = ['area', 'caches', 'extern', 'vscode', 'chrome', 'tmp'];

export function esFasePc(f: unknown): f is FasePc {
  return typeof f === 'string' && (Object.keys(FASES_PC) as string[]).includes(f);
}

/* Fases con selección por ruta suelta (`--solo-ruta`, validada contra su
 * crudo): el área y tmp. El resto filtra por clave (`--solo`).
 * [por que] tmp trae rutas heterogéneas (targets por rama, sueltos, TEMP)
 * que solo tienen sentido elegidas una a una, igual que el área. */
export function esPorRuta(fase: FasePc): boolean {
  return fase === 'area' || fase === 'tmp';
}

export interface EntradaPc {
  fase: FasePc;
  clave: string;
  ruta: string;
  bytes: number;
  detalle: string;
}

export interface ReportePc {
  entradas: EntradaPc[];
  totalBytes: number;
  medidoEn: string;
  versionBinario: string | null;
}

export interface AccionPc {
  fase: FasePc;
  clave: string;
  gb: number;
  estado: string;
  detalle: string;
}

export interface ResumenReintento {
  fase: FasePc;
  candidatas: number;
  resultado: 'omitido' | 'exito' | 'fallo-lanzamiento' | 'denegado';
}

export interface ResultadoLimpieza {
  acciones: AccionPc[];
  liberadosGb: number;
  /* Trazabilidad del reintento elevado (UAC) por fase: la UI lo usa para
   * explicar si hubo diálogo de Windows, si se denegó o si no procedía. */
  reintentos: ResumenReintento[];
}

export type EventoScan =
  | { tipo: 'inicio'; fase: FasePc; etiqueta: string; indice: number; total: number }
  | { tipo: 'preparando'; detalle: string }
  | { tipo: 'avance'; fase: FasePc; etiqueta: string; dir: string; dirs: number; halladas: number }
  | { tipo: 'fase'; fase: FasePc; etiqueta: string; entradas: EntradaPc[]; totalBytes: number }
  | { tipo: 'fin'; totalBytes: number; n: number; medidoEn: string; versionBinario: string | null }
  | { tipo: 'error'; fase: FasePc; etiqueta: string; detalle: string };

/* Foto del análisis en curso (para que una pestaña recargada se reenganche
 * en vez de creer que no pasa nada). null si no hay trabajo activo. */
export interface AvanceScan {
  enCurso: boolean;
  preparando: boolean;
  fase: FasePc;
  etiqueta: string;
  indice: number;
  total: number;
  dir: string;
  dirs: number;
  halladas: number;
}

/* Cola serial: una pasada pesada a la vez (medir/borrar GB solapados
 * falsearia totales y saturaria el disco). */
let cola: Promise<unknown> = Promise.resolve();

export function encolar<T>(fn: () => Promise<T>): Promise<T> {
  const turno = cola.then(fn);
  cola = turno.catch(() => {});
  return turno;
}

export function dirPc(): string {
  const d = join(RAIZ_AREA, 'workspace-manager', 'data', 'pc');
  mkdirSync(d, { recursive: true });
  return d;
}

export function rutaReporte(): string {
  return join(dirPc(), 'ultimo.json');
}

export function rutaMeta(): string {
  return join(dirPc(), 'ultimo.meta.json');
}

/* Crudo por fase: el *-clean exige el JSON original de su fase como
 * --reporte, así que se guarda aparte del reporte unido de la UI. */
export function rutaCrudo(fase: FasePc): string {
  return join(dirPc(), `crudo-${fase}.json`);
}

/* Escritura atómica (tmp + rename): un lector concurrente (p. ej. validar
 * la selección de un borrado mientras el análisis reescribe los crudos)
 * nunca ve un JSON truncado a medias.
 * [por que] writeFileSync directo dejaba una ventana donde leerReporte o
 * rutasVistasEnCrudo parseaban medio fichero y el borrado fallaba con 500. */
export function escribirAtomico(ruta: string, contenido: string): void {
  const tmp = `${ruta}.tmp`;
  writeFileSync(tmp, contenido);
  renameSync(tmp, ruta);
}
