/* Ejecucion de limpiador-pc por fase: escaneo (solo lectura) y limpieza.
 * [por que] Capa de ejecucion separada de las rutas HTTP: args fijos por
 * allowlist (sin shell, sin input libre), cola serial para no solapar dos
 * pasadas pesadas, y normalizacion del JSON de cada fase a un shape comun
 * para el panel. El reporte crudo se persiste en data/pc/ (gitignored): es
 * la unica fuente que acepta el *-clean, igual que en el CLI. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_AREA } from '../http.js';
import { asegurarBinario } from './binario.js';

const execFileAsync = promisify(execFile);

export type FasePc = 'area' | 'caches' | 'extern' | 'vscode' | 'chrome';

export const FASES_PC: Record<
  FasePc,
  { scan: string; clean: string; etiqueta: string; descripcion: string; filtro: 'solo_tipo' | 'solo' }
> = {
  area: {
    scan: 'scan',
    clean: 'clean',
    etiqueta: 'área de trabajo',
    descripcion: 'node_modules, target y dist del área (fase 1)',
    filtro: 'solo_tipo',
  },
  caches: {
    scan: 'caches-scan',
    clean: 'caches-clean',
    etiqueta: 'caches del perfil',
    descripcion: 'caches regenerables del perfil (fase 2+4)',
    filtro: 'solo',
  },
  extern: {
    scan: 'extern-scan',
    clean: 'extern-clean',
    etiqueta: 'herramientas externas',
    descripcion: 'limpia vía comando oficial, nunca borra directo (fase 3)',
    filtro: 'solo',
  },
  vscode: {
    scan: 'vscode-scan',
    clean: 'vscode-clean',
    etiqueta: 'VS Code',
    descripcion: 'basura de Roaming/Code de más de 14 días (fase 5)',
    filtro: 'solo',
  },
  chrome: {
    scan: 'chrome-scan',
    clean: 'chrome-clean',
    etiqueta: 'Chrome',
    descripcion: 'caches de Chrome, nunca toca logins (fase 6)',
    filtro: 'solo',
  },
};

export function esFasePc(f: unknown): f is FasePc {
  return typeof f === 'string' && (Object.keys(FASES_PC) as string[]).includes(f);
}

export interface EntradaPc {
  clave: string;
  ruta: string;
  bytes: number;
  detalle: string;
}

export interface ResultadoScan {
  fase: FasePc;
  entradas: EntradaPc[];
  totalBytes: number;
  medidoEn: string;
  versionBinario: string | null;
}

export interface AccionPc {
  clave: string;
  gb: number;
  estado: string;
  detalle: string;
}

export interface ResultadoLimpieza {
  fase: FasePc;
  ejecutar: boolean;
  acciones: AccionPc[];
  liberadosGb: number;
}

/* Cola serial: una pasada pesada a la vez (medir/borrar GB solapados
 * falsearia totales y saturaria el disco). */
let cola: Promise<unknown> = Promise.resolve();

function encolar<T>(fn: () => Promise<T>): Promise<T> {
  const turno = cola.then(fn);
  cola = turno.catch(() => {});
  return turno;
}

function dirPc(): string {
  const d = join(RAIZ_AREA, 'workspace-manager', 'data', 'pc');
  mkdirSync(d, { recursive: true });
  return d;
}

function rutaReporte(fase: FasePc): string {
  return join(dirPc(), `ultimo-${fase}.json`);
}

function rutaMeta(fase: FasePc): string {
  return join(dirPc(), `ultimo-${fase}.meta.json`);
}

/* Normaliza el JSON crudo de cada fase al shape comun del panel. */
function normalizar(fase: FasePc, crudo: unknown): { entradas: EntradaPc[]; totalBytes: number } {
  const obj = (crudo ?? {}) as { entradas?: unknown; total_bytes?: unknown };
  const lista = Array.isArray(obj.entradas) ? (obj.entradas as Record<string, unknown>[]) : [];
  const entradas: EntradaPc[] = lista.map((e) => {
    if (fase === 'area') {
      return {
        clave: String(e.tipo ?? '?'),
        ruta: String(e.ruta ?? ''),
        bytes: Number(e.bytes ?? 0),
        detalle: String(e.motivo ?? ''),
      };
    }
    const extra = String(e.motivo ?? e.comando ?? '');
    return {
      clave: String(e.nombre ?? '?'),
      ruta: String(e.ruta ?? ''),
      bytes: Number(e.bytes ?? 0),
      detalle: extra,
    };
  });
  const total =
    typeof obj.total_bytes === 'number'
      ? obj.total_bytes
      : entradas.reduce((a, e) => a + e.bytes, 0);
  return { entradas, totalBytes: total };
}

function correrBinario(bin: string, args: string[]): Promise<string> {
  return encolar(async () => {
    const { stdout } = await execFileAsync(bin, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 300000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return String(stdout);
  });
}

export async function escanearPc(fase: FasePc): Promise<ResultadoScan> {
  const { bin, version } = await asegurarBinario();
  const meta = FASES_PC[fase];
  const args = fase === 'area' ? [meta.scan, '--json', '--top', '0'] : [meta.scan, '--json'];
  const salida = await correrBinario(bin, args);
  let crudo: unknown;
  try {
    crudo = JSON.parse(salida) as unknown;
  } catch {
    throw new Error('el limpiador no devolvió JSON válido');
  }
  writeFileSync(rutaReporte(fase), JSON.stringify(crudo));
  const { entradas, totalBytes } = normalizar(fase, crudo);
  const medidoEn = new Date().toISOString();
  writeFileSync(rutaMeta(fase), JSON.stringify({ medidoEn, versionBinario: version, totalBytes, n: entradas.length }));
  return { fase, entradas, totalBytes, medidoEn, versionBinario: version };
}

/* Solo se aceptan identificadores simples: el CLI valida el resto. */
function validarSolo(solo: unknown): string[] {
  if (solo === undefined) return [];
  if (!Array.isArray(solo) || solo.length > 40) throw new Error('filtro solo inválido');
  return solo.map((s) => {
    if (typeof s !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(s)) throw new Error(`filtro inválido: ${String(s)}`);
    return s;
  });
}

export async function limpiarPc(
  fase: FasePc,
  ejecutar: boolean,
  soloRaw: unknown,
): Promise<ResultadoLimpieza> {
  const solo = validarSolo(soloRaw);
  const reporte = rutaReporte(fase);
  if (!existsSync(reporte)) throw new Error('sin análisis previo: analiza primero esta fase');
  const { bin } = await asegurarBinario();
  const meta = FASES_PC[fase];
  const flag = meta.filtro === 'solo_tipo' ? '--solo-tipo' : '--solo';
  const args = [meta.clean, '--reporte', reporte, '--json'];
  if (ejecutar) args.push('--ejecutar');
  for (const s of solo) args.push(flag, s);
  const salida = await correrBinario(bin, args);
  let dato: { ejecutar?: unknown; acciones?: unknown; liberados_gb?: unknown };
  try {
    dato = JSON.parse(salida) as typeof dato;
  } catch {
    throw new Error('el limpiador no devolvió JSON válido');
  }
  /* Tras un borrado real el reporte queda obsoleto: se invalida para
   * obligar a re-analizar antes de la siguiente pasada. */
  if (ejecutar) {
    try {
      unlinkSync(reporte);
    } catch {
      /* best-effort: el próximo scan lo sobrescribe igualmente */
    }
    try {
      unlinkSync(rutaMeta(fase));
    } catch {
      /* idem */
    }
  }
  const crudas = Array.isArray(dato.acciones) ? (dato.acciones as Record<string, unknown>[]) : [];
  const acciones: AccionPc[] = crudas.map((a) => ({
    clave: String(a.ruta ?? a.cache ?? a.objetivo ?? '?'),
    gb: Number(a.gb ?? 0),
    estado: String(a.estado ?? '?'),
    detalle: String(a.detalle ?? ''),
  }));
  return {
    fase,
    ejecutar: dato.ejecutar === true,
    acciones,
    liberadosGb: Number(dato.liberados_gb ?? 0),
  };
}

export interface MetaReporte {
  medidoEn: string | null;
  versionBinario: string | null;
  totalBytes: number;
  n: number;
}

/* Meta del último análisis guardado (para mostrar "analizado hace…" sin
 * re-escanear). Null si la fase aún no se analizó o ya se limpió. */
export function leerMeta(fase: FasePc): MetaReporte | null {
  try {
    const f = rutaMeta(fase);
    if (!existsSync(f) || !existsSync(rutaReporte(fase))) return null;
    const m = JSON.parse(readFileSync(f, 'utf8')) as Partial<MetaReporte>;
    return {
      medidoEn: typeof m.medidoEn === 'string' ? m.medidoEn : null,
      versionBinario: typeof m.versionBinario === 'string' ? m.versionBinario : null,
      totalBytes: typeof m.totalBytes === 'number' ? m.totalBytes : 0,
      n: typeof m.n === 'number' ? m.n : 0,
    };
  } catch {
    return null;
  }
}
