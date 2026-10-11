/* Topes del Guardián (10AA-2 F11.4): edita `budgets` de sentinel.config.json y el
 * extra de lote-extra.md, los dos ficheros que Sentinel lee para los topes
 * (heavyBudget.ts). [por que] Mismo patrón que politica.ts: solo se reescribe el
 * bloque `budgets`, el resultado se verifica con deepStrictEqual, el hash previo
 * evita pisar una edición ajena (409) y se reverifica justo antes de escribir.
 * Decidido: una ampliación de lote va como línea nueva ARRIBA con el total
 * acumulado y el historial queda debajo. Sentinel toma solo el primer entero del
 * fichero, así que la primera línea fija el extra vigente y no se pierde historial. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { type BloqueDiff, type Eol, diffLineas, eolDe, escribirAtomico, hashDe, leerFichero } from '../escritura.js';
import { CLASES_TOPE, type ClaseTope, type ModoTope, extraDeOverride } from './lector.js';
import { ErrorValidacion } from './politica.js';

const CONFIG = 'sentinel.config.json';
const EXTRA = 'lote-extra.md';
const TOPE_MAX = 100;
const EXTRA_MAX = 100;
const MOTIVO_MAX = 120;
/* Solo se edita un `budgets` de nivel raíz con su llave en la misma línea; cualquier
 * otra forma se rechaza en vez de adivinarla. */
const RE_BUDGETS = /^ {2}"budgets": \{/mu;

/* limites: null quita la clave (vuelve al tope por defecto de Sentinel).
 * extraTotal es el extra TOTAL vigente (0..100), no un delta. */
export interface CambioTopes {
  modo?: ModoTope;
  limites?: Partial<Record<ClaseTope, number | null>>;
  extraTotal?: number;
  motivo?: string;
}

/* Hashes con los que la página leyó los dos ficheros. extra null = no existe. */
export interface HashesTopes {
  config: string;
  extra: string | null;
}

export interface PlanTopes {
  original: { config: string; extra: string | null };
  nuevo: { config: string; extra: string | null };
  cambia: boolean;
  diffConfig: BloqueDiff | null;
  diffExtra: BloqueDiff | null;
}

export type ResultadoCalculo = { estado: 'ok'; plan: PlanTopes } | { estado: 'conflicto' | 'error'; motivo: string };

export type ResultadoGuardado =
  | { estado: 'ok'; cambia: boolean; hashes: HashesTopes; diffConfig: BloqueDiff | null; diffExtra: BloqueDiff | null }
  | { estado: 'conflicto' | 'error'; motivo: string; configRevertida?: boolean };

interface PlanConfig {
  nuevo: string;
  cambia: boolean;
  diff: BloqueDiff | null;
}

interface PlanExtra {
  nuevo: string | null;
  cambia: boolean;
  diff: BloqueDiff | null;
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function enteroEn(valor: unknown, min: number, max: number, nombre: string): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < min || valor > max) {
    throw new ErrorValidacion(`${nombre} debe ser un entero entre ${min} y ${max}`);
  }
  return valor;
}

/* Valida la entrada de la API. Lanza ErrorValidacion (la ruta responde 422). */
export function validarCambioTopes(entrada: unknown): CambioTopes {
  if (!esObjeto(entrada)) throw new ErrorValidacion('el cambio debe ser un objeto');
  const cambio: CambioTopes = {};
  const modo = entrada.modo;
  if (modo !== undefined) {
    if (modo !== 'observe' && modo !== 'enforce') throw new ErrorValidacion(`modo de topes no válido: ${String(modo)}`);
    cambio.modo = modo;
  }
  const limites = entrada.limites;
  if (limites !== undefined) {
    if (!esObjeto(limites)) throw new ErrorValidacion('limites debe ser un objeto');
    const salida: Partial<Record<ClaseTope, number | null>> = {};
    for (const [clase, valor] of Object.entries(limites)) {
      if (!(CLASES_TOPE as readonly string[]).includes(clase)) throw new ErrorValidacion(`clase de tope desconocida: ${clase}`);
      salida[clase as ClaseTope] = valor === null ? null : enteroEn(valor, 0, TOPE_MAX, `limite de ${clase}`);
    }
    cambio.limites = salida;
  }
  const extraTotal = entrada.extraTotal;
  if (extraTotal !== undefined) cambio.extraTotal = enteroEn(extraTotal, 0, EXTRA_MAX, 'extraTotal');
  const motivo = entrada.motivo;
  if (motivo !== undefined) {
    if (typeof motivo !== 'string') throw new ErrorValidacion('motivo debe ser texto');
    cambio.motivo = motivo.replace(/\s+/gu, ' ').trim().slice(0, MOTIVO_MAX);
  }
  return cambio;
}

/* Rango del bloque `budgets` de raíz, desde el inicio de su línea hasta la llave
 * de cierre, por conteo de llaves (como bloqueDirectCommands en politica.ts). */
function localizarBudgets(contenido: string): { inicio: number; fin: number } | null {
  const apariciones = contenido.match(/"budgets"\s*:/gu)?.length ?? 0;
  if (apariciones > 1) throw new ErrorValidacion('budgets aparece más de una vez');
  const m = RE_BUDGETS.exec(contenido);
  if (!m) {
    if (apariciones === 1) throw new ErrorValidacion('budgets no está en el nivel raíz: hay que editarlo a mano');
    return null;
  }
  let profundidad = 0;
  for (let i = m.index + m[0].length - 1; i < contenido.length; i++) {
    if (contenido[i] === '{') profundidad++;
    else if (contenido[i] === '}' && --profundidad === 0) return { inicio: m.index, fin: i + 1 };
  }
  throw new ErrorValidacion('budgets sin llave de cierre');
}

/* JSON del bloque con la sangría de raíz (2) y los finales de línea del fichero. */
function serializarBloque(valor: Record<string, unknown>, eol: Eol): string {
  return JSON.stringify(valor, null, 2)
    .split('\n')
    .map((linea, i) => (i === 0 ? linea : `  ${linea}`))
    .join(eol);
}

/* Añade la línea al final del objeto raíz, tras su último valor y con coma. */
function insertarAlFinal(contenido: string, linea: string, eol: Eol): string {
  const cierre = contenido.lastIndexOf('}');
  if (cierre < 0) throw new ErrorValidacion('la raíz de sentinel.config.json no tiene llave de cierre');
  let ultimo = cierre - 1;
  while (ultimo >= 0 && /\s/u.test(contenido[ultimo])) ultimo--;
  const coma = contenido[ultimo] === '{' ? '' : ',';
  return contenido.slice(0, ultimo + 1) + coma + eol + linea + contenido.slice(ultimo + 1);
}

function planificarBudgets(contenido: string, doc: Record<string, unknown>, cambio: CambioTopes): PlanConfig {
  const budgets = doc.budgets;
  if (budgets !== undefined && !esObjeto(budgets)) throw new ErrorValidacion('budgets no es un objeto');
  const previo: Record<string, unknown> = esObjeto(budgets) ? budgets : {};
  const nuevo: Record<string, unknown> = { ...previo };
  if (cambio.modo !== undefined) nuevo.mode = cambio.modo;
  if (cambio.limites !== undefined && Object.keys(cambio.limites).length > 0) {
    const limits: Record<string, unknown> = esObjeto(previo.limits) ? { ...previo.limits } : {};
    for (const [clase, valor] of Object.entries(cambio.limites)) {
      if (valor === undefined) continue;
      if (valor === null) delete limits[clase];
      else limits[clase] = valor;
    }
    /* Sin claves, `limits` se quita: Sentinel usa el tope por defecto igual. */
    if (Object.keys(limits).length > 0) nuevo.limits = limits;
    else delete nuevo.limits;
  }
  if (JSON.stringify(nuevo) === JSON.stringify(previo)) return { nuevo: contenido, cambia: false, diff: null };

  const eol = eolDe(contenido);
  const bloque = `  "budgets": ${serializarBloque(nuevo, eol)}`;
  const ubicacion = localizarBudgets(contenido);
  const texto = ubicacion
    ? contenido.slice(0, ubicacion.inicio) + bloque + contenido.slice(ubicacion.fin)
    : insertarAlFinal(contenido, bloque, eol);
  assert.deepStrictEqual(JSON.parse(texto), { ...doc, budgets: nuevo }, 'la edición no produce la configuración prevista');
  return { nuevo: texto, cambia: true, diff: diffLineas(contenido, texto) };
}

/* Línea nueva arriba con el extra total y el historial debajo. Si el extra vigente
 * ya es el pedido, no toca el fichero. Sin fichero, el extra vigente es 0. */
function planificarExtra(actual: string | null, total: number, motivo: string, fecha: string): PlanExtra {
  const sinCambio = actual === null ? total === 0 : extraDeOverride(actual) === total;
  if (sinCambio) return { nuevo: actual, cambia: false, diff: null };
  const texto = actual ?? '';
  const nuevo = `+${total} ${motivo || 'ajuste desde Guardián'} (${fecha})${eolDe(texto)}${texto}`;
  assert.equal(extraDeOverride(nuevo), total, 'la primera cifra de lote-extra.md no es el total');
  return { nuevo, cambia: true, diff: diffLineas(texto, nuevo) };
}

/* Relee ambos ficheros justo antes de escribir: si cambiaron desde el cálculo, no
 * se pisan. [por que] Igual que politica.ts: sin bloqueo de ficheros solo hay
 * comprobación, no garantía total. */
function reverificar(raiz: string, previo: HashesTopes): string | null {
  const cfg = leerFichero(join(raiz, CONFIG));
  const ext = leerFichero(join(raiz, EXTRA));
  const extraHash = ext.estado === 'ok' ? ext.hash : null;
  if (cfg.estado !== 'ok' || cfg.hash !== previo.config || extraHash !== previo.extra) {
    return 'los topes cambiaron mientras se calculaba la edición; recarga la página';
  }
  return null;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/* Calcula la edición sin escribir. Lanza ErrorValidacion si el cambio no encaja en
 * la configuración (p. ej. budgets no es un objeto). */
export function calcularTopes(raiz: string, previo: HashesTopes, cambio: CambioTopes, fecha: string = hoy()): ResultadoCalculo {
  const cfg = leerFichero(join(raiz, CONFIG));
  if (cfg.estado !== 'ok') {
    return { estado: 'error', motivo: cfg.estado === 'ausente' ? 'el proyecto no tiene sentinel.config.json' : cfg.motivo };
  }
  const ext = leerFichero(join(raiz, EXTRA));
  if (ext.estado === 'invalido') return { estado: 'error', motivo: ext.motivo };
  const extraActual = ext.estado === 'ok' ? ext.contenido : null;
  const extraHash = ext.estado === 'ok' ? ext.hash : null;
  if (cfg.hash !== previo.config || extraHash !== previo.extra) {
    return { estado: 'conflicto', motivo: 'los topes cambiaron desde que se leyeron; recarga la página' };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(cfg.contenido);
  } catch {
    return { estado: 'error', motivo: 'sentinel.config.json no es JSON válido' };
  }
  if (!esObjeto(doc)) return { estado: 'error', motivo: 'la raíz de sentinel.config.json no es un objeto' };
  const config = planificarBudgets(cfg.contenido, doc, cambio);
  const extra: PlanExtra =
    cambio.extraTotal === undefined
      ? { nuevo: extraActual, cambia: false, diff: null }
      : planificarExtra(extraActual, cambio.extraTotal, cambio.motivo ?? '', fecha);
  return {
    estado: 'ok',
    plan: {
      original: { config: cfg.contenido, extra: extraActual },
      nuevo: { config: config.nuevo, extra: extra.nuevo },
      cambia: config.cambia || extra.cambia,
      diffConfig: config.diff,
      diffExtra: extra.diff,
    },
  };
}

/* Escribe la edición. Exige el hash previo, reverifica y escribe primero la
 * configuración; si escribir lote-extra.md falla, revierte la configuración. */
export function guardarTopes(
  raiz: string,
  previo: HashesTopes,
  cambio: CambioTopes,
  fecha: string = hoy(),
  escribir: (ruta: string, contenido: string) => void = escribirAtomico,
): ResultadoGuardado {
  const r = calcularTopes(raiz, previo, cambio, fecha);
  if (r.estado !== 'ok') return r;
  const { plan } = r;
  if (!plan.cambia) return { estado: 'ok', cambia: false, hashes: previo, diffConfig: null, diffExtra: null };
  const motivo = reverificar(raiz, previo);
  if (motivo) return { estado: 'conflicto', motivo };

  const rutaConfig = join(raiz, CONFIG);
  let configEscrita = false;
  try {
    if (plan.nuevo.config !== plan.original.config) {
      escribir(rutaConfig, plan.nuevo.config);
      configEscrita = true;
    }
    if (plan.nuevo.extra !== null && plan.nuevo.extra !== plan.original.extra) {
      escribir(join(raiz, EXTRA), plan.nuevo.extra);
    }
  } catch (err) {
    let configRevertida = false;
    if (configEscrita) {
      try {
        escribir(rutaConfig, plan.original.config);
        configRevertida = true;
      } catch {
        /* queda sin revertir: se informa en configRevertida */
      }
    }
    return {
      estado: 'error',
      motivo: err instanceof Error ? err.message : String(err),
      configRevertida: configEscrita ? configRevertida : undefined,
    };
  }
  return {
    estado: 'ok',
    cambia: true,
    hashes: {
      config: hashDe(plan.nuevo.config),
      extra: plan.nuevo.extra === null ? null : hashDe(plan.nuevo.extra),
    },
    diffConfig: plan.diffConfig,
    diffExtra: plan.diffExtra,
  };
}
