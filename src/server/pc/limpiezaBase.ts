/* Base compartida del borrado del limpiador-pc [0610A-1]: ejecución
 * tolerante, validación de la selección, parseo, reintento elevado y poda.
 * [por que] `limpieza.ts` superaba el límite (331 efectivas): la mitad de
 * una pasada (`limpiarPc`) y la mitad en vivo (`limpiarTodo`) comparten
 * estos helpers; viven aquí una sola vez, sin ciclos (la base solo mira
 * a `ejecucion.js`, `elevacion.js` y `scan.js`). */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import {
  encolar,
  escribirAtomico,
  esFasePc,
  esPorRuta,
  FASES_PC,
  rutaCrudo,
  rutaMeta,
  rutaReporte,
} from './ejecucion.js';
import type { AccionPc, FasePc, ResumenReintento } from './ejecucion.js';
import { ejecutarCleanElevado, esFalloPermiso, esRutaAdmin } from './elevacion.js';
import { leerReporte } from './scan.js';

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
export async function ejecutarClean(bin: string, args: string[]): Promise<{ salida: string }> {
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

export { correrClean };

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

export function validarSeleccion(sel: unknown): SeleccionPc[] {
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

/* Ruta real de una fila: área/tmp la traen (`--solo-ruta`); en el resto
 * el CLI devuelve la clave y la ruta se resuelve en el reporte unido.
 * [por que] Sin esto, esRutaAdmin('') es false y ModelZoo jamás
 * calificaría para el reintento elevado. */
function rutaDeFila(fase: FasePc, fila: FilaLimpieza): string {
  if (fila.ruta !== '') return fila.ruta;
  try {
    const previas = leerReporte();
    const hallada = previas?.entradas.find((e) => e.fase === fase && e.clave === fila.clave);
    return hallada?.ruta ?? '';
  } catch {
    return '';
  }
}

/* Reintento elevado: las filas que fallaron por permiso fuera del perfil
 * (ProgramData y demás ámbito de máquina) se repiten en UNA llamada con
 * UAC, limitada a esas claves. Devuelve las filas fusionadas (el reintento
 * sustituye a la fila fallida por clave) y lo liberado extra.
 * [por que] Sin esto, ModelZoo y cía quedan en «fallo» eterno con os error
 * 5; elevar todo el borrado pediría UAC hasta para el perfil. El diálogo
 * de Windows lo acepta el usuario una vez por fase con este caso. */
export async function reintentarAdminSiProcede(
  bin: string,
  fase: FasePc,
  flag: string,
  filas: FilaLimpieza[],
): Promise<{ filas: FilaLimpieza[]; liberados: number; resumen: ResumenReintento }> {
  const candidatas = filas.filter(
    (f) => f.estado === 'fallo' && esFalloPermiso(f.detalle) && esRutaAdmin(rutaDeFila(fase, f)),
  );
  if (candidatas.length === 0) return { filas, liberados: 0, resumen: { fase, candidatas: 0, resultado: 'omitido' } };
  const meta = FASES_PC[fase];
  const args = [meta.clean, '--reporte', rutaCrudo(fase), '--json', '--ejecutar'];
  /* Camino del reintento: 'exito' si el elevado devolvió filas reales;
   * el catch lo marca como 'denegado' o 'fallo-lanzamiento'. */
  let viaFallback: ResumenReintento['resultado'] = 'exito';
  for (const c of candidatas) {
    /* En área/tmp el filtro es la ruta; en el resto, la clave del objetivo.
     * Ambas vienen validadas (reporte o regex) antes de llegar aquí. */
    args.push(flag, esPorRuta(fase) ? c.ruta : c.clave);
  }
  const { salida } = await ejecutarCleanElevado(bin, args).catch((err: unknown) => {
    /* UAC denegado o lanzamiento imposible: no tumba el resto del borrado;
     * las filas conservan su fallo original con el motivo del reintento
     * delante (el detalle del CLI ya llena 500 caracteres y lo taparía
     * detrás), en forma de CLI para que el parseo las reconozca. */
    const motivo = String(err instanceof Error ? err.message : err);
    viaFallback = motivo.includes('elevación denegada') ? 'denegado' : 'fallo-lanzamiento';
    return {
      salida: JSON.stringify({
        acciones: candidatas.map((c) => ({
          ...(esPorRuta(fase) ? { ruta: c.ruta } : { cache: c.clave }),
          gb: c.gb,
          estado: 'fallo',
          detalle: `${motivo} | ${c.detalle}`.slice(0, 500),
        })),
        liberados_gb: 0,
      }),
    };
  });
  const parte = parsearSalidaLimpieza(fase, salida);
  const nuevas = new Map(parte.filas.map((f) => [`${esPorRuta(fase) ? f.ruta : f.clave}`, f]));
  const fusionadas = filas.map((f) => nuevas.get(esPorRuta(fase) ? f.ruta : f.clave) ?? f);
  return {
    filas: fusionadas,
    liberados: parte.liberados,
    resumen: { fase, candidatas: candidatas.length, resultado: viaFallback },
  };
}

/* Estados que retiran la entrada del reporte (el resto —fallo, rechazada,
 * simulada— sigue en disco y se queda en la tab). */
export const ELIMINADA_LIMPIEZA: readonly string[] = ['borrada', 'vaciada', 'limpiada'];

/* Fila del limpiador con su ruta para mostrarla en vivo (AccionPc no la trae). */
export interface FilaLimpieza extends AccionPc {
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

export function parsearSalidaLimpieza(fase: FasePc, salida: string): { filas: FilaLimpieza[]; liberados: number } {
  let dato: { acciones?: unknown; liberados_gb?: unknown };
  try {
    dato = JSON.parse(salida) as typeof dato;
  } catch {
    throw new Error('el limpiador no devolvió JSON válido');
  }
  const crudas = Array.isArray(dato.acciones) ? (dato.acciones as Record<string, unknown>[]) : [];
  return { filas: crudas.map((a) => filaDeLimpieza(fase, a)), liberados: Number(dato.liberados_gb ?? 0) };
}

export function agruparSeleccion(seleccion: SeleccionPc[]): Map<FasePc, string[]> {
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
export function podarReporte(acciones: AccionPc[]): void {
  const previas = leerReporte();
  if (!previas) return;
  const borradas = new Set(
    acciones.filter((a) => ELIMINADA_LIMPIEZA.includes(a.estado)).map((a) => `${a.fase}::${a.clave}`),
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
