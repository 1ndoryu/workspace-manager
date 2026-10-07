/* Lector del estado Guard por proyecto (07AA-6 F6): lee la política del tope
 * físico anti-espiral y su diario de decisiones SIN ejecutar nada.
 * [por que] El panel Guard necesita "quién/qué/cuándo/por qué": la política
 * vive en `<raiz>/sentinel.config.json` (clave `budgets`, espejo tolerante de
 * `readBudgets` de Sentinel) y el diario en
 * `<raiz>/.quality-reports/<etapa>/<tarea>/runs.jsonl` (una línea por intento,
 * la escribe `checkAndRecordHeavyRun`). Es solo lectura síncrona con topes
 * (nunca se ejecuta el gate desde aquí) y tolerante: config ausente/ilegible
 * o líneas corruptas se reportan, no rompen. Sin secretos en las respuestas:
 * runs.jsonl solo trae ts/kind/stage/status/used/limit/extra/mode. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type ModoTope = 'observe' | 'enforce';

/* Clases contables. [por que] Espejo de HEAVY_BUDGET_CLASSES de Sentinel
 * (fuente única real); si Sentinel añade una clase, este lector la muestra
 * igual (las claves desconocidas de runs.jsonl también se agregan). */
export const LIMITE_TOPE_DEFECTO = 5;

/* Topes del propio lector: barrer .quality-reports no puede crecer sin cota.
 * [por que] Un proyecto con cientos de tareas generaría una respuesta
 * gigante; se capan ficheros y líneas por fichero. */
const MAX_TAREAS = 100;
const MAX_LINEAS_POR_RUNS = 5000;

export interface ClaseGuard {
  iniciados: number;
  bloqueados: number;
  ultimoTs: string | null;
  usado: number;
  limite: number;
  extra: number;
  modo: ModoTope;
}

export interface TareaGuard {
  tarea: string;
  etapa: string;
  clases: Record<string, ClaseGuard>;
  totalBloqueados: number;
  ultimoTs: string | null;
}

export interface PoliticaGuard {
  /* ok: budgets leído (o defaults si no hay clave); ausente: sin
   * sentinel.config.json (Sentinel también aplica defaults); ilegible: el
   * JSON no parsea (Sentinel aplica defaults en silencio: aquí se avisa). */
  config: 'ok' | 'ausente' | 'ilegible';
  modo: ModoTope;
  limites: Record<string, number>;
  /* Claves de limits ajenas a las clases contables: Sentinel las acepta y las
   * usa si la clase aparece; aquí se listan para que un typo sea visible. */
  limitesExtra: string[];
}

export interface OverrideGuard {
  existe: boolean;
  extra: number;
  primeraLinea: string;
}

export interface EstadoGuardProyecto {
  clave: string;
  ruta: string;
  politica: PoliticaGuard;
  override: OverrideGuard;
  tareas: TareaGuard[];
  totalBloqueados: number;
}

function esModo(v: unknown): v is ModoTope {
  return v === 'observe' || v === 'enforce';
}

function enteroTope(v: unknown): number | null {
  const n = Number(v);
  /* [por que] Mismo rango que readBudgets (0..100): el panel muestra lo que
   * Sentinel aplica, no una validación propia distinta. */
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

/* Lee budgets de sentinel.config.json con la misma tolerancia que Sentinel:
 * sin fichero o sin clave → defaults observe; modo distinto de 'enforce' →
 * observe; limits no numéricos se ignoran. La diferencia: aquí se distingue
 * ausente/ilegible para no presentar un default silencioso como política. */
export function leerPolitica(raiz: string): PoliticaGuard {
  const ruta = join(raiz, 'sentinel.config.json');
  let crudo: string;
  try {
    crudo = readFileSync(ruta, 'utf8');
  } catch {
    return { config: 'ausente', modo: 'observe', limites: {}, limitesExtra: [] };
  }
  let valor: unknown;
  try {
    valor = JSON.parse(crudo) as unknown;
  } catch {
    return { config: 'ilegible', modo: 'observe', limites: {}, limitesExtra: [] };
  }
  const budgets = (valor as { budgets?: unknown } | null)?.budgets;
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) {
    return { config: 'ok', modo: 'observe', limites: {}, limitesExtra: [] };
  }
  const rec = budgets as { mode?: unknown; limits?: unknown };
  const modo: ModoTope = rec.mode === 'enforce' ? 'enforce' : 'observe';
  const limites: Record<string, number> = {};
  const limitesExtra: string[] = [];
  if (rec.limits && typeof rec.limits === 'object' && !Array.isArray(rec.limits)) {
    for (const [k, v] of Object.entries(rec.limits as Record<string, unknown>)) {
      const n = enteroTope(v);
      if (n === null) continue;
      limites[k] = n;
      if (k !== 'cargo-check' && k !== 'cargo-clippy' && k !== 'cargo-test' && k !== 'tsc-noemit') {
        limitesExtra.push(k);
      }
    }
  }
  return { config: 'ok', modo, limites, limitesExtra };
}

/* Lee <raiz>/lote-extra.md: el primer entero (+N) amplía el cupo en N.
 * [por que] Misma regex que readOverrideExtra (`\+?(\d+)`): el panel muestra
 * el extra EFECTIVO que Sentinel aplica. */
export function leerOverride(raiz: string): OverrideGuard {
  let contenido: string;
  try {
    contenido = readFileSync(join(raiz, 'lote-extra.md'), 'utf8');
  } catch {
    return { existe: false, extra: 0, primeraLinea: '' };
  }
  const m = contenido.match(/\+?(\d+)/u);
  const primeraLinea = (contenido.split('\n')[0] ?? '').slice(0, 120);
  return { existe: true, extra: m ? Math.max(0, parseInt(m[1], 10)) : 0, primeraLinea };
}

interface LineaRun {
  kind?: unknown;
  stage?: unknown;
  status?: unknown;
  ts?: unknown;
  used?: unknown;
  limit?: unknown;
  extra?: unknown;
  mode?: unknown;
}

/* Agrega un runs.jsonl a su TareaGuard: solo 'started' consume cupo (usado =
 * cuenta de started de esa clase); 'blocked' cuenta aparte como bloqueo. */
function agregarRuns(tarea: TareaGuard, texto: string): void {
  let n = 0;
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    if (++n > MAX_LINEAS_POR_RUNS) break;
    let r: LineaRun;
    try {
      r = JSON.parse(linea) as LineaRun;
    } catch {
      continue;
    }
    if (typeof r.kind !== 'string' || r.kind === '') continue;
    const actual = tarea.clases[r.kind] ?? {
      iniciados: 0,
      bloqueados: 0,
      ultimoTs: null,
      usado: 0,
      limite: LIMITE_TOPE_DEFECTO,
      extra: 0,
      modo: 'observe' as ModoTope,
    };
    if (r.status === 'started') actual.iniciados += 1;
    else if (r.status === 'blocked') {
      actual.bloqueados += 1;
      tarea.totalBloqueados += 1;
    } else continue;
    if (typeof r.ts === 'string' && (actual.ultimoTs === null || r.ts > actual.ultimoTs)) {
      actual.ultimoTs = r.ts;
      if (tarea.ultimoTs === null || r.ts > tarea.ultimoTs) tarea.ultimoTs = r.ts;
    }
    const usado = enteroTope(r.used);
    if (usado !== null) actual.usado = usado;
    const limite = enteroTope(r.limit);
    if (limite !== null) actual.limite = limite;
    const extra = enteroTope(r.extra);
    if (extra !== null) actual.extra = extra;
    if (esModo(r.mode)) actual.modo = r.mode;
    tarea.clases[r.kind] = actual;
  }
}

/* Barrea <raiz>/.quality-reports/<etapa>/<tarea>/runs.jsonl (los reportRoot
 * por tarea de Sentinel). Orden: último movimiento primero. */
export function leerTareas(raiz: string): TareaGuard[] {
  const base = join(raiz, '.quality-reports');
  let etapas: string[];
  try {
    etapas = readdirSync(base).filter((e) => {
      try {
        return statSync(join(base, e)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
  const tareas: TareaGuard[] = [];
  for (const etapa of etapas.sort()) {
    let nombres: string[];
    try {
      nombres = readdirSync(join(base, etapa));
    } catch {
      continue;
    }
    for (const tarea of nombres.sort()) {
      if (tareas.length >= MAX_TAREAS) break;
      const runs = join(base, etapa, tarea, 'runs.jsonl');
      if (!existsSync(runs)) continue;
      let texto: string;
      try {
        texto = readFileSync(runs, 'utf8');
      } catch {
        continue;
      }
      const tg: TareaGuard = { tarea, etapa, clases: {}, totalBloqueados: 0, ultimoTs: null };
      agregarRuns(tg, texto);
      if (Object.keys(tg.clases).length > 0) tareas.push(tg);
    }
    if (tareas.length >= MAX_TAREAS) break;
  }
  tareas.sort((a, b) => (b.ultimoTs ?? '').localeCompare(a.ultimoTs ?? ''));
  return tareas;
}

export function leerGuardProyecto(clave: string, ruta: string): EstadoGuardProyecto {
  const tareas = leerTareas(ruta);
  return {
    clave,
    ruta,
    politica: leerPolitica(ruta),
    override: leerOverride(ruta),
    tareas,
    totalBloqueados: tareas.reduce((acc, t) => acc + t.totalBloqueados, 0),
  };
}
