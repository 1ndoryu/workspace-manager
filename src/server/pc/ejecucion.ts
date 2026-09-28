/* Ejecucion de limpiador-pc: un solo analisis global con progreso en vivo.
 * [por que] La tab PC es una sola cosa (un boton analiza todo): el server
 * recorre las 5 fases en serie y emite cada resultado parcial para que la UI
 * muestre lo encontrado en tiempo real (incluido que carpeta se esta
 * midiendo: el binario avisa por stderr desde 0.3.0). El reporte unido se
 * persiste en data/pc/ (gitignored): rehidrata la tab al recargar y es la
 * unica fuente que acepta la limpieza, igual que en el CLI. Trabajo unico:
 * un segundo cliente se adjunta al scan en curso (reenvio + en vivo) en vez
 * de duplicarlo, asi recargar no pierde el analisis. Cola serial para no
 * solapar dos pasadas pesadas; args fijos por allowlist (sin shell, sin
 * input libre). */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_AREA } from '../http.js';
import { asegurarBinario, estadoBinario } from './binario.js';

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
};

export const ORDEN_FASES_PC: FasePc[] = ['area', 'caches', 'extern', 'vscode', 'chrome'];

export function esFasePc(f: unknown): f is FasePc {
  return typeof f === 'string' && (Object.keys(FASES_PC) as string[]).includes(f);
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

export interface ResultadoLimpieza {
  acciones: AccionPc[];
  liberadosGb: number;
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

function rutaReporte(): string {
  return join(dirPc(), 'ultimo.json');
}

function rutaMeta(): string {
  return join(dirPc(), 'ultimo.meta.json');
}

/* Crudo por fase: el *-clean exige el JSON original de su fase como
 * --reporte, así que se guarda aparte del reporte unido de la UI. */
function rutaCrudo(fase: FasePc): string {
  return join(dirPc(), `crudo-${fase}.json`);
}

/* Normaliza el JSON crudo de una fase al shape comun del panel. */
function normalizar(fase: FasePc, crudo: unknown): { entradas: EntradaPc[]; totalBytes: number } {
  const obj = (crudo ?? {}) as { entradas?: unknown; total_bytes?: unknown };
  const lista = Array.isArray(obj.entradas) ? (obj.entradas as Record<string, unknown>[]) : [];
  const entradas: EntradaPc[] = lista.map((e) => {
    if (fase === 'area') {
      return {
        fase,
        clave: String(e.tipo ?? '?'),
        ruta: String(e.ruta ?? ''),
        bytes: Number(e.bytes ?? 0),
        detalle: String(e.motivo ?? ''),
      };
    }
    const extra = String(e.motivo ?? e.comando ?? '');
    return {
      fase,
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

/* Ejecuta un *-scan con stderr en vivo: stdout trae el JSON final y cada
 * línea NDJSON de stderr (`{dir, dirs, halladas}`, desde limpiador 0.3.0)
 * dice qué carpeta se está midiendo. Las fases sin avance (rápidas) solo
 * devuelven su JSON. */
function correrScan(
  bin: string,
  args: string[],
  onAvance: (a: { dir: string; dirs: number; halladas: number }) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hijo = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let resto = '';
    const limite = setTimeout(() => {
      try {
        hijo.kill();
      } catch {
        /* ya terminó */
      }
      reject(new Error('el limpiador excedió el tiempo (10 min)'));
    }, 600000);
    hijo.stdout.setEncoding('utf8');
    hijo.stdout.on('data', (d: string) => {
      stdout += d;
    });
    hijo.stderr.setEncoding('utf8');
    hijo.stderr.on('data', (d: string) => {
      resto += d;
      const lineas = resto.split('\n');
      resto = lineas.pop() ?? '';
      for (const l of lineas) {
        try {
          const p = JSON.parse(l) as { dir?: unknown; dirs?: unknown; halladas?: unknown };
          if (typeof p.dir === 'string') {
            onAvance({ dir: p.dir, dirs: Number(p.dirs ?? 0), halladas: Number(p.halladas ?? 0) });
          }
        } catch {
          /* líneas ERROR del binario: no son avance, se ignoran aquí */
        }
      }
    });
    hijo.on('error', (err) => {
      clearTimeout(limite);
      reject(err);
    });
    hijo.on('close', (codigo) => {
      clearTimeout(limite);
      if (codigo === 0) resolve(stdout);
      else reject(new Error(`el limpiador salió con código ${codigo}`));
    });
  });
}

/* Trabajo único de análisis: un solo scan global a la vez. Si llega otro
 * cliente (pestaña recargada, doble clic) se adjunta al que ya corre: se
 * le reenvía el inicio actual + las fases completadas y sigue en vivo.
 * [por que] Antes cada GET arrancaba su propio scan encolado: recargar
 * dejaba a la UI ciega (sin estado del trabajo en curso) y el segundo scan
 * repetía todo el trabajo al terminar el primero. */
interface TrabajoScan {
  avance: AvanceScan;
  completadas: Extract<EventoScan, { tipo: 'fase' }>[];
  oyentes: Set<(ev: EventoScan) => void>;
  terminado: Promise<void>;
  resolver: () => void;
}

let trabajo: TrabajoScan | null = null;

function emitir(ev: EventoScan): void {
  if (!trabajo) return;
  for (const o of trabajo.oyentes) {
    try {
      o(ev);
    } catch {
      /* oyente con la conexión caída: sigue con los demás */
    }
  }
}

/* Foto del trabajo en curso para /api/pc/estado (null si está parado). */
export function estadoScan(): AvanceScan | null {
  return trabajo ? { ...trabajo.avance } : null;
}

/* Análisis global: recorre las fases en serie e informa cada tramo para
 * mostrar el progreso en vivo (qué carpeta se mide y lo que va apareciendo).
 * Al terminar persiste el reporte unido + crudos y limpia los reportes
 * legacy por fase del diseño anterior. Se resuelve cuando el trabajo
 * termina (también para los clientes adjuntados a mitad). */
export function escanearTodo(informa: (ev: EventoScan) => void): Promise<void> {
  if (trabajo) {
    const t = trabajo;
    informa({ tipo: 'inicio', fase: t.avance.fase, etiqueta: t.avance.etiqueta, indice: t.avance.indice, total: t.avance.total });
    for (const f of t.completadas) informa(f);
    if (t.avance.preparando) {
      informa({ tipo: 'preparando', detalle: DETALLE_PREPARANDO });
    } else {
      informa({ tipo: 'avance', fase: t.avance.fase, etiqueta: t.avance.etiqueta, dir: t.avance.dir, dirs: t.avance.dirs, halladas: t.avance.halladas });
    }
    t.oyentes.add(informa);
    return t.terminado;
  }
  let resolver!: () => void;
  const terminado = new Promise<void>((res) => {
    resolver = res;
  });
  trabajo = {
    avance: {
      enCurso: true,
      preparando: true,
      fase: 'area',
      etiqueta: FASES_PC.area.etiqueta,
      indice: 1,
      total: ORDEN_FASES_PC.length,
      dir: '',
      dirs: 0,
      halladas: 0,
    },
    completadas: [],
    oyentes: new Set([informa]),
    terminado,
    resolver,
  };
  void encolar(cuerpoScan);
  return terminado;
}

/* Texto del evento preparando (la recompilación tras actualizar el
 * limpiador tarda decenas de segundos sin medir nada: antes era un hueco
 * mudo que se sentía como "va más lento"). */
const DETALLE_PREPARANDO = 'reconstruyendo limpiador-pc (solo tras actualizar)…';

async function cuerpoScan(): Promise<void> {
  const t = trabajo;
  if (!t) return;
  try {
    /* Si el binario está al día no hay espera: se sale de preparando sin
     * avisar (el inicio de fase llega enseguida). */
    const previo = await estadoBinario();
    if (!previo.existe || !previo.actualizado) {
      emitir({ tipo: 'preparando', detalle: DETALLE_PREPARANDO });
    }
    const { bin, version } = await asegurarBinario();
    t.avance = { ...t.avance, preparando: false };
    const todas: EntradaPc[] = [];
    for (let i = 0; i < ORDEN_FASES_PC.length; i++) {
      const fase = ORDEN_FASES_PC[i];
      const meta = FASES_PC[fase];
      t.avance = { enCurso: true, preparando: false, fase, etiqueta: meta.etiqueta, indice: i + 1, total: ORDEN_FASES_PC.length, dir: '', dirs: 0, halladas: 0 };
      emitir({ tipo: 'inicio', fase, etiqueta: meta.etiqueta, indice: i + 1, total: ORDEN_FASES_PC.length });
      try {
        const args = fase === 'area' ? [meta.scan, '--json', '--top', '0'] : [meta.scan, '--json'];
        const salida = await correrScan(bin, args, (a) => {
          t.avance = { ...t.avance, dir: a.dir, dirs: a.dirs, halladas: a.halladas };
          emitir({ tipo: 'avance', fase, etiqueta: meta.etiqueta, dir: a.dir, dirs: a.dirs, halladas: a.halladas });
        });
        let crudo: unknown;
        try {
          crudo = JSON.parse(salida) as unknown;
        } catch {
          throw new Error('el limpiador no devolvió JSON válido');
        }
        writeFileSync(rutaCrudo(fase), JSON.stringify(crudo));
        const { entradas, totalBytes } = normalizar(fase, crudo);
        todas.push(...entradas);
        const ev: Extract<EventoScan, { tipo: 'fase' }> = { tipo: 'fase', fase, etiqueta: meta.etiqueta, entradas, totalBytes };
        t.completadas.push(ev);
        emitir(ev);
      } catch (err) {
        emitir({ tipo: 'error', fase, etiqueta: meta.etiqueta, detalle: String(err) });
      }
    }
    const totalBytes = todas.reduce((a, e) => a + e.bytes, 0);
    const medidoEn = new Date().toISOString();
    const reporte: ReportePc = { entradas: todas, totalBytes, medidoEn, versionBinario: version };
    writeFileSync(rutaReporte(), JSON.stringify(reporte));
    writeFileSync(
      rutaMeta(),
      JSON.stringify({ medidoEn, versionBinario: version, totalBytes, n: todas.length }),
    );
    /* Limpieza del formato anterior (un reporte por fase): ya no se usa. */
    for (const fase of ORDEN_FASES_PC) {
      for (const f of [join(dirPc(), `ultimo-${fase}.json`), join(dirPc(), `ultimo-${fase}.meta.json`)] ) {
        try {
          unlinkSync(f);
        } catch {
          /* best-effort */
        }
      }
    }
    emitir({ tipo: 'fin', totalBytes, n: todas.length, medidoEn, versionBinario: version });
  } finally {
    if (trabajo === t) trabajo = null;
    t.resolver();
  }
}

/* Último análisis guardado (rehidrata la tab al recargar sin re-escanear).
 * Null si aún no se analizó. */
export function leerReporte(): ReportePc | null {
  try {
    const f = rutaReporte();
    if (!existsSync(f)) return null;
    const r = JSON.parse(readFileSync(f, 'utf8')) as Partial<ReportePc>;
    if (!Array.isArray(r.entradas)) return null;
    return {
      entradas: r.entradas as EntradaPc[],
      totalBytes: typeof r.totalBytes === 'number' ? r.totalBytes : 0,
      medidoEn: typeof r.medidoEn === 'string' ? r.medidoEn : '',
      versionBinario: typeof r.versionBinario === 'string' ? r.versionBinario : null,
    };
  } catch {
    return null;
  }
}

/* Selección del cliente: en el área se eligen rutas sueltas (el CLI trae
 * `--solo-ruta` desde 0.2.0); en el resto, claves por objetivo. La ruta del
 * área se valida contra las vistas en su reporte: solo se puede pedir lo
 * que el análisis encontró, nada arbitrario. */
export interface SeleccionPc {
  fase: FasePc;
  clave: string;
  ruta?: string;
}

function rutasVistasEnCrudo(fase: FasePc): Set<string> {
  try {
    const crudo = JSON.parse(readFileSync(rutaCrudo(fase), 'utf8')) as {
      entradas?: { ruta?: unknown }[];
    };
    const lista = Array.isArray(crudo.entradas) ? crudo.entradas : [];
    return new Set(lista.map((e) => String(e.ruta ?? '')));
  } catch {
    return new Set();
  }
}

function validarSeleccion(sel: unknown): SeleccionPc[] {
  if (!Array.isArray(sel) || sel.length === 0 || sel.length > 200) {
    throw new Error('selección vacía o excesiva (máx 200)');
  }
  const vistasArea = rutasVistasEnCrudo('area');
  return sel.map((s) => {
    const o = (s ?? {}) as { fase?: unknown; clave?: unknown; ruta?: unknown };
    if (!esFasePc(o.fase)) throw new Error('fase inválida en la selección');
    if (o.fase === 'area') {
      /* Ruta suelta: debe ser una de las vistas en el reporte del área. */
      if (typeof o.ruta !== 'string' || !vistasArea.has(o.ruta)) {
        throw new Error('ruta no vista en el análisis del área');
      }
      return { fase: o.fase, clave: typeof o.clave === 'string' ? o.clave : '', ruta: o.ruta };
    }
    if (typeof o.clave !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(o.clave)) {
      throw new Error(`filtro inválido: ${String(o.clave)}`);
    }
    return { fase: o.fase, clave: o.clave };
  });
}

/* Borrado real (sin simulación): agrupa la selección por fase y ejecuta un
 * *-clean por fase con sus filtros. Al terminar poda del reporte unido las
 * entradas borradas para que la tab refleje lo que queda sin re-escanear. */
export async function limpiarPc(seleccionRaw: unknown): Promise<ResultadoLimpieza> {
  const seleccion = validarSeleccion(seleccionRaw);
  if (!existsSync(rutaReporte())) throw new Error('sin análisis previo: analiza primero');
  const { bin } = await asegurarBinario();
  const porFase = new Map<FasePc, string[]>();
  for (const s of seleccion) {
    /* En el área el filtro es la ruta suelta; en el resto, la clave. */
    const valor = s.fase === 'area' ? (s.ruta ?? '') : s.clave;
    const lista = porFase.get(s.fase) ?? [];
    if (valor !== '' && !lista.includes(valor)) lista.push(valor);
    porFase.set(s.fase, lista);
  }
  const acciones: AccionPc[] = [];
  let liberadosGb = 0;
  for (const fase of ORDEN_FASES_PC) {
    const solo = porFase.get(fase);
    if (!solo || solo.length === 0) continue;
    const crudo = rutaCrudo(fase);
    if (!existsSync(crudo)) throw new Error(`sin análisis previo de ${FASES_PC[fase].etiqueta}: analiza primero`);
    const meta = FASES_PC[fase];
    const flag = fase === 'area' ? '--solo-ruta' : '--solo';
    const args = [meta.clean, '--reporte', crudo, '--json', '--ejecutar'];
    for (const s of solo) args.push(flag, s);
    const salida = await correrBinario(bin, args);
    let dato: { acciones?: unknown; liberados_gb?: unknown };
    try {
      dato = JSON.parse(salida) as typeof dato;
    } catch {
      throw new Error('el limpiador no devolvió JSON válido');
    }
    const crudas = Array.isArray(dato.acciones) ? (dato.acciones as Record<string, unknown>[]) : [];
    for (const a of crudas) {
      acciones.push({
        fase,
        clave: String(a.ruta ?? a.cache ?? a.objetivo ?? '?'),
        gb: Number(a.gb ?? 0),
        estado: String(a.estado ?? '?'),
        detalle: String(a.detalle ?? ''),
      });
    }
    liberadosGb += Number(dato.liberados_gb ?? 0);
  }
  /* Poda del reporte unido: quita lo seleccionado de las fases limpiadas
   * (en el área por ruta suelta, en el resto por clave). */
  const previas = leerReporte();
  if (previas) {
    const borradas = new Set(
      seleccion.map((s) => (s.fase === 'area' ? `area::${s.ruta ?? ''}` : `${s.fase}::${s.clave}`)),
    );
    const entradas = previas.entradas.filter(
      (e) => !borradas.has(e.fase === 'area' ? `area::${e.ruta}` : `${e.fase}::${e.clave}`),
    );
    const totalBytes = entradas.reduce((a, e) => a + e.bytes, 0);
    writeFileSync(rutaReporte(), JSON.stringify({ ...previas, entradas, totalBytes }));
    writeFileSync(
      rutaMeta(),
      JSON.stringify({ medidoEn: previas.medidoEn, versionBinario: previas.versionBinario, totalBytes, n: entradas.length }),
    );
  }
  return { acciones, liberadosGb };
}
