/* Análisis del limpiador-pc: un solo scan global a la vez, por SSE.
 * [por que] [299A-11] Bloque E: sale de ejecucion.js (590 líneas efectivas)
 * junto con limpieza.js; la base (fases, tipos, cola, rutas) queda en
 * ejecucion.js. El ciclo scan ↔ limpieza (predicados de exclusión mutua)
 * es solo en tiempo de llamada —nunca en la carga— y tsc lo verifica. */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { asegurarBinario, estadoBinario } from './binario.js';
import {
  dirPc,
  encolar,
  escribirAtomico,
  esPorRuta,
  FASES_PC,
  ORDEN_FASES_PC,
  rutaCrudo,
  rutaMeta,
  rutaReporte,
} from './ejecucion.js';
import type { AvanceScan, EntradaPc, EventoScan, FasePc, ReportePc } from './ejecucion.js';
import { hayLimpiezaEnCurso } from './limpieza.js';

/* Normaliza el JSON crudo de una fase al shape comun del panel. */
function normalizar(fase: FasePc, crudo: unknown): { entradas: EntradaPc[]; totalBytes: number } {
  const obj = (crudo ?? {}) as { entradas?: unknown; total_bytes?: unknown };
  const lista = Array.isArray(obj.entradas) ? (obj.entradas as Record<string, unknown>[]) : [];
  const entradas: EntradaPc[] = lista.map((e) => {
    if (esPorRuta(fase)) {
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

/* Predicado para la exclusión mutua con el borrado (vive en limpieza.js;
 * el import cruzado scan ↔ limpieza solo se usa dentro de funciones). */
export function hayScanEnCurso(): boolean {
  return trabajo !== null;
}

/* Análisis global: recorre las fases en serie e informa cada tramo para
 * mostrar el progreso en vivo (qué carpeta se mide y lo que va apareciendo).
 * Al terminar persiste el reporte unido + crudos y limpia los reportes
 * legacy por fase del diseño anterior. Se resuelve cuando el trabajo
 * termina (también para los clientes adjuntados a mitad). */
export function escanearTodo(informa: (ev: EventoScan) => void): Promise<void> {
  /* Exclusión con el borrado: el scan reescribe crudos y reporte. */
  if (hayLimpiezaEnCurso()) {
    throw new Error('hay un borrado en curso: espera a que termine y reintenta el análisis');
  }
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
        escribirAtomico(rutaCrudo(fase), JSON.stringify(crudo));
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
    escribirAtomico(rutaReporte(), JSON.stringify(reporte));
    escribirAtomico(
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
