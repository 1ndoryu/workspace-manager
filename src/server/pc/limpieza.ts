/* Borrado del limpiador-pc: limpiarPc (una pasada) y limpiarTodo (SSE).
 * [por que] [299A-11] Bloque E: sale de ejecucion.js (590 líneas efectivas)
 * junto con scan.js; la base (fases, tipos, cola, rutas) queda en
 * ejecucion.js. El ciclo limpieza ↔ scan (predicados de exclusión mutua)
 * es solo en tiempo de llamada —nunca en la carga— y tsc lo verifica. */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { asegurarBinario } from './binario.js';
import {
  encolar,
  escribirAtomico,
  esFasePc,
  esPorRuta,
  FASES_PC,
  ORDEN_FASES_PC,
  rutaCrudo,
  rutaMeta,
  rutaReporte,
} from './ejecucion.js';
import type { AccionPc, FasePc, ResultadoLimpieza } from './ejecucion.js';
import { hayScanEnCurso, leerReporte } from './scan.js';

const execFileAsync = promisify(execFile);

/* Ejecuta un *-clean tolerando el éxito parcial: el limpiador devuelve 0
 * (borrado completo), 1 (algunas entradas rechazadas o con fallo, el resto
 * borradas) o 2 (fatal, sin JSON). Con 1 el stdout trae el JSON con el
 * estado de cada acción y se aprovecha; solo 2 o un stdout inservible
 * son error.
 * [por que] Antes cualquier código != 0 tiraba un 500 que descartaba el
 * JSON: lo ya borrado no se podaba del reporte y la UI mostraba el
 * comando en vez del estado por fila («borrada» frente a «rechazada» o
 * «fallo» con su motivo). */
function correrClean(bin: string, args: string[]): Promise<{ salida: string }> {
  return encolar(() => ejecutarClean(bin, args));
}

/* Ejecución sin cola (para el cuerpo del borrado en vivo, que ya corre
 * dentro de la cola serial: encolar dentro de encolar se bloquearía). */
async function ejecutarClean(bin: string, args: string[]): Promise<{ salida: string }> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 300000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { salida: String(stdout) };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: unknown };
    const salida = String((e.stdout as string) ?? '');
    if (e.code === 1 && salida.trim().length > 0) return { salida };
    throw err;
  }
}

/* Selección del cliente: en el área y tmp se eligen rutas sueltas (el CLI trae
 * `--solo-ruta`); en el resto, claves por objetivo. La ruta se valida contra
 * las vistas en su reporte: solo se puede pedir lo que el análisis encontró,
 * nada arbitrario. */
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
  const vistasPorRuta = new Map<FasePc, Set<string>>([
    ['area', rutasVistasEnCrudo('area')],
    ['tmp', rutasVistasEnCrudo('tmp')],
  ]);
  return sel.map((s) => {
    const o = (s ?? {}) as { fase?: unknown; clave?: unknown; ruta?: unknown };
    if (!esFasePc(o.fase)) throw new Error('fase inválida en la selección');
    if (esPorRuta(o.fase)) {
      /* Ruta suelta: debe ser una de las vistas en el reporte de su fase. */
      if (typeof o.ruta !== 'string' || !vistasPorRuta.get(o.fase)?.has(o.ruta)) {
        throw new Error('ruta no vista en el análisis de su fase');
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
  /* Exclusión con el análisis: mientras el scan reescribe crudos y reporte,
   * validar o podar contra esos ficheros mezcla parejas inconsistentes
   * (reporte viejo + crudo nuevo) y el borrado falla o actúa sobre datos
   * que la UI ya no muestra. El 409 de la ruta lo explica al usuario. */
  if (hayScanEnCurso()) throw new Error('hay un análisis en curso: espera a que termine y reintenta el borrado');
  if (hayLimpiezaEnCurso()) throw new Error('hay un borrado en curso: espera a que termine y reintenta el borrado');
  const seleccion = validarSeleccion(seleccionRaw);
  if (!existsSync(rutaReporte())) throw new Error('sin análisis previo: analiza primero');
  const { bin } = await asegurarBinario();
  const porFase = agruparSeleccion(seleccion);
  const acciones: AccionPc[] = [];
  let liberadosGb = 0;
  for (const fase of ORDEN_FASES_PC) {
    const solo = porFase.get(fase);
    if (!solo || solo.length === 0) continue;
    const meta = FASES_PC[fase];
    const flag = esPorRuta(fase) ? '--solo-ruta' : '--solo';
    const args = [meta.clean, '--reporte', rutaCrudo(fase), '--json', '--ejecutar'];
    for (const s of solo) args.push(flag, s);
    /* Sigue con las demás fases aunque esta quede parcial: cada fila trae
     * su estado y la poda solo retira lo realmente eliminado. */
    const { salida } = await correrClean(bin, args);
    const parte = parsearSalidaLimpieza(fase, salida);
    acciones.push(...parte.filas);
    liberadosGb += parte.liberados;
  }
  podarReporte(acciones);
  return { acciones, liberadosGb };
}

/* Estados que retiran la entrada del reporte (el resto —fallo, rechazada,
 * simulada— sigue en disco y se queda en la tab). */
const ELIMINADA_LIMPIEZA = new Set(['borrada', 'vaciada', 'limpiada']);

/* Fila del limpiador con su ruta para mostrarla en vivo (AccionPc no la trae). */
interface FilaLimpieza extends AccionPc {
  ruta: string;
}

function filaDeLimpieza(fase: FasePc, a: Record<string, unknown>): FilaLimpieza {
  return {
    fase,
    clave: String(a.ruta ?? a.cache ?? a.objetivo ?? '?'),
    ruta: String(a.ruta ?? ''),
    gb: Number(a.gb ?? 0),
    estado: String(a.estado ?? '?'),
    detalle: String(a.detalle ?? ''),
  };
}

function parsearSalidaLimpieza(fase: FasePc, salida: string): { filas: FilaLimpieza[]; liberados: number } {
  let dato: { acciones?: unknown; liberados_gb?: unknown };
  try {
    dato = JSON.parse(salida) as typeof dato;
  } catch {
    throw new Error('el limpiador no devolvió JSON válido');
  }
  const crudas = Array.isArray(dato.acciones) ? (dato.acciones as Record<string, unknown>[]) : [];
  return { filas: crudas.map((a) => filaDeLimpieza(fase, a)), liberados: Number(dato.liberados_gb ?? 0) };
}

function agruparSeleccion(seleccion: SeleccionPc[]): Map<FasePc, string[]> {
  const porFase = new Map<FasePc, string[]>();
  for (const s of seleccion) {
    /* En área y tmp el filtro es la ruta suelta; en el resto, la clave. */
    const valor = esPorRuta(s.fase) ? (s.ruta ?? '') : s.clave;
    const lista = porFase.get(s.fase) ?? [];
    if (valor !== '' && !lista.includes(valor)) lista.push(valor);
    porFase.set(s.fase, lista);
  }
  return porFase;
}

/* Poda del reporte unido: solo retira lo realmente eliminado (estados
 * «borrada» en area y tmp, «vaciada» en caches/vscode/chrome, «limpiada» en
 * extern), nunca lo seleccionado a ciegas.
 * [por que] Con éxito parcial, podar la selección entera hacía
 * desaparecer de la tab entradas que siguen en disco. */
function podarReporte(acciones: AccionPc[]): void {
  const previas = leerReporte();
  if (!previas) return;
  const borradas = new Set(
    acciones.filter((a) => ELIMINADA_LIMPIEZA.has(a.estado)).map((a) => `${a.fase}::${a.clave}`),
  );
  const entradas = previas.entradas.filter(
    (e) => !borradas.has(esPorRuta(e.fase) ? `${e.fase}::${e.ruta}` : `${e.fase}::${e.clave}`),
  );
  const totalBytes = entradas.reduce((a, e) => a + e.bytes, 0);
  escribirAtomico(rutaReporte(), JSON.stringify({ ...previas, entradas, totalBytes }));
  escribirAtomico(
    rutaMeta(),
    JSON.stringify({ medidoEn: previas.medidoEn, versionBinario: previas.versionBinario, totalBytes, n: entradas.length }),
  );
}

export type EventoLimpieza =
  | { tipo: 'inicio'; total: number }
  | { tipo: 'fase'; fase: FasePc; etiqueta: string; actual: number; total: number }
  | { tipo: 'fila'; fase: FasePc; clave: string; ruta: string; gb: number; estado: string; detalle: string }
  | { tipo: 'fin'; liberadosGb: number; eliminadas: number; fallos: number }
  | { tipo: 'error'; fase: FasePc; etiqueta: string; detalle: string };

/* Trabajo único de borrado: como el scan, un segundo cliente se adjunta
 * (reenvío de lo emitido + en vivo) en vez de duplicar el borrado.
 * [por que] Borrar GB tarda minutos; recargar a mitad no debe ni perder
 * el progreso ni lanzar un segundo borrado sobre lo mismo. */
interface TrabajoLimpieza {
  total: number;
  emitidas: EventoLimpieza[];
  oyentes: Set<(ev: EventoLimpieza) => void>;
  terminado: Promise<ResultadoLimpieza>;
  resolver: (r: ResultadoLimpieza) => void;
}

let trabajoLimpieza: TrabajoLimpieza | null = null;

/* Foto del borrado en curso para /api/pc/estado (null si está parado). */
export function estadoLimpieza(): { enCurso: boolean; hechas: number; total: number } | null {
  if (!trabajoLimpieza) return null;
  return {
    enCurso: true,
    hechas: trabajoLimpieza.emitidas.filter((e) => e.tipo === 'fila').length,
    total: trabajoLimpieza.total,
  };
}

/* Predicado para la exclusión mutua con el análisis (vive en scan.js). */
export function hayLimpiezaEnCurso(): boolean {
  return trabajoLimpieza !== null;
}

/* Adjunta un cliente al borrado en curso (reenvío + en vivo). Null si no
 * hay trabajo activo (p. ej. recarga tardía). */
export function adjuntarLimpieza(
  informa: (ev: EventoLimpieza) => void,
): Promise<ResultadoLimpieza> | null {
  const t = trabajoLimpieza;
  if (!t) return null;
  for (const ev of t.emitidas) informa(ev);
  t.oyentes.add(informa);
  return t.terminado;
}

/* Borrado con progreso en vivo: emite inicio → fase → fila (cada objetivo
 * al completarse) → fin. El área va ruta a ruta (cada node_modules tarda
 * minutos) para que la UI muestre en vivo qué se está borrando. */
export function limpiarTodo(
  seleccionRaw: unknown,
  informa: (ev: EventoLimpieza) => void,
): Promise<ResultadoLimpieza> {
  if (hayScanEnCurso()) throw new Error('hay un análisis en curso: espera a que termine y reintenta el borrado');
  const seleccion = validarSeleccion(seleccionRaw);
  if (trabajoLimpieza) {
    const t = trabajoLimpieza;
    for (const ev of t.emitidas) informa(ev);
    t.oyentes.add(informa);
    return t.terminado;
  }
  let resolver!: (r: ResultadoLimpieza) => void;
  const terminado = new Promise<ResultadoLimpieza>((res) => {
    resolver = res;
  });
  trabajoLimpieza = { total: seleccion.length, emitidas: [], oyentes: new Set([informa]), terminado, resolver };
  void encolar(() => cuerpoLimpieza(seleccion));
  return terminado;
}

async function cuerpoLimpieza(seleccion: SeleccionPc[]): Promise<void> {
  const t = trabajoLimpieza;
  if (!t) return;
  const emite = (ev: EventoLimpieza): void => {
    t.emitidas.push(ev);
    for (const o of t.oyentes) {
      try {
        o(ev);
      } catch {
        /* oyente con la conexión caída: sigue con los demás */
      }
    }
  };
  const acciones: AccionPc[] = [];
  let liberadosGb = 0;
  try {
    if (!existsSync(rutaReporte())) throw new Error('sin análisis previo: analiza primero');
    const { bin } = await asegurarBinario();
    const porFase = agruparSeleccion(seleccion);
    const fases = ORDEN_FASES_PC.filter((f) => (porFase.get(f)?.length ?? 0) > 0);
    emite({ tipo: 'inicio', total: seleccion.length });
    let actual = 0;
    for (const fase of fases) {
      actual++;
      const meta = FASES_PC[fase];
      emite({ tipo: 'fase', fase, etiqueta: meta.etiqueta, actual, total: fases.length });
      try {
        liberadosGb += await ejecutarFaseLimpieza(bin, fase, porFase.get(fase) ?? [], (f) => {
          acciones.push(f);
          emite({ tipo: 'fila', fase: f.fase, clave: f.clave, ruta: f.ruta, gb: f.gb, estado: f.estado, detalle: f.detalle });
        });
      } catch (err) {
        emite({ tipo: 'error', fase, etiqueta: meta.etiqueta, detalle: String(err) });
      }
    }
    podarReporte(acciones);
    const eliminadas = acciones.filter((a) => ELIMINADA_LIMPIEZA.has(a.estado)).length;
    emite({ tipo: 'fin', liberadosGb, eliminadas, fallos: acciones.length - eliminadas });
    t.resolver({ acciones, liberadosGb });
  } catch (err) {
    emite({ tipo: 'error', fase: 'area', etiqueta: '', detalle: String(err) });
    t.resolver({ acciones, liberadosGb });
  } finally {
    if (trabajoLimpieza === t) trabajoLimpieza = null;
  }
}

/* Una fase del borrado: área y tmp van ruta a ruta para emitir cada
 * objetivo al completarse (un target tarda minutos); el resto va en una
 * sola llamada con sus claves y se emiten sus filas al terminar. */
async function ejecutarFaseLimpieza(
  bin: string,
  fase: FasePc,
  valores: string[],
  porFila: (f: FilaLimpieza) => void,
): Promise<number> {
  const meta = FASES_PC[fase];
  const crudo = rutaCrudo(fase);
  if (!existsSync(crudo)) throw new Error(`sin análisis previo de ${meta.etiqueta}: analiza primero`);
  const flag = esPorRuta(fase) ? '--solo-ruta' : '--solo';
  const lotes = esPorRuta(fase) ? valores.map((v) => [v]) : [valores];
  let liberados = 0;
  for (const lote of lotes) {
    const args = [meta.clean, '--reporte', crudo, '--json', '--ejecutar'];
    for (const s of lote) args.push(flag, s);
    const { salida } = await ejecutarClean(bin, args);
    const parte = parsearSalidaLimpieza(fase, salida);
    liberados += parte.liberados;
    for (const f of parte.filas) porFila(f);
  }
  return liberados;
}
