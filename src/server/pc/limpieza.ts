/* Borrado del limpiador-pc: limpiarPc (una pasada) y limpiarTodo (SSE).
 * [por que] [299A-11] Bloque E: sale de ejecucion.js (590 líneas efectivas)
 * junto con scan.js; la base (fases, tipos, cola, rutas) queda en
 * ejecucion.js. El ciclo limpieza ↔ scan (predicados de exclusión mutua)
 * es solo en tiempo de llamada —nunca en la carga— y tsc lo verifica.
 * [0610A-1] Ejecución, validación, parseo, reintento y poda viven en
 * limpiezaBase.js (compartidos por ambas mitades); aquí solo orquesta. */
import { existsSync } from 'node:fs';
import { asegurarBinario } from './binario.js';
import {
  encolar,
  esPorRuta,
  FASES_PC,
  ORDEN_FASES_PC,
  rutaCrudo,
  rutaReporte,
} from './ejecucion.js';
import type { AccionPc, FasePc, ResumenReintento, ResultadoLimpieza } from './ejecucion.js';
import { hayScanEnCurso } from './scan.js';
import {
  agruparSeleccion,
  correrClean,
  ejecutarClean,
  ELIMINADA_LIMPIEZA,
  parsearSalidaLimpieza,
  podarReporte,
  reintentarAdminSiProcede,
  validarSeleccion,
  type FilaLimpieza,
  type SeleccionPc,
} from './limpiezaBase.js';

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
  const reintentos: ResumenReintento[] = [];
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
    const reintento = await reintentarAdminSiProcede(bin, fase, flag, parte.filas);
    acciones.push(...reintento.filas);
    reintentos.push(reintento.resumen);
    liberadosGb += parte.liberados + reintento.liberados;
  }
  podarReporte(acciones);
  return { acciones, liberadosGb, reintentos };
}

/* Mitad en vivo (SSE): borrado fase a fase emitiendo el estado por fila. */
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
  const reintentos: ResumenReintento[] = [];
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
        const r = await ejecutarFaseLimpieza(bin, fase, porFase.get(fase) ?? [], (f) => {
          acciones.push(f);
          emite({ tipo: 'fila', fase: f.fase, clave: f.clave, ruta: f.ruta, gb: f.gb, estado: f.estado, detalle: f.detalle });
        });
        liberadosGb += r.liberados;
        reintentos.push(r.resumen);
      } catch (err) {
        emite({ tipo: 'error', fase, etiqueta: meta.etiqueta, detalle: String(err) });
      }
    }
    podarReporte(acciones);
    const eliminadas = acciones.filter((a) => ELIMINADA_LIMPIEZA.includes(a.estado)).length;
    emite({ tipo: 'fin', liberadosGb, eliminadas, fallos: acciones.length - eliminadas });
    t.resolver({ acciones, liberadosGb, reintentos });
  } catch (err) {
    emite({ tipo: 'error', fase: 'area', etiqueta: '', detalle: String(err) });
    t.resolver({ acciones, liberadosGb, reintentos });
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
): Promise<{ liberados: number; resumen: ResumenReintento }> {
  const meta = FASES_PC[fase];
  const crudo = rutaCrudo(fase);
  if (!existsSync(crudo)) throw new Error(`sin análisis previo de ${meta.etiqueta}: analiza primero`);
  const flag = esPorRuta(fase) ? '--solo-ruta' : '--solo';
  const lotes = esPorRuta(fase) ? valores.map((v) => [v]) : [valores];
  let liberados = 0;
  let resumen: ResumenReintento = { fase, candidatas: 0, resultado: 'omitido' };
  for (const lote of lotes) {
    const args = [meta.clean, '--reporte', crudo, '--json', '--ejecutar'];
    for (const s of lote) args.push(flag, s);
    const { salida } = await ejecutarClean(bin, args);
    const parte = parsearSalidaLimpieza(fase, salida);
    const reintento = await reintentarAdminSiProcede(bin, fase, flag, parte.filas);
    liberados += parte.liberados + reintento.liberados;
    resumen = reintento.resumen;
    for (const f of reintento.filas) porFila(f);
  }
  return { liberados, resumen };
}
