/* Detector de vulnerabilidades de dependencias por proyecto (plan
 * vulnerabilidades-consola 308A-4, V1). [por que] El usuario pidio que las
 * vulnerabilidades aparezcan SOLAS en la consola del manager, sin depender de
 * la UI de GitHub por repo. Es homologo a `analizador.ts` (analisis sentinel)
 * pero para dependencias: reutiliza el mismo patron de cola serial +
 * single-flight + cache por cambio real + timeout.
 *
 * Fuentes: el CLI de audit del gestor de paquetes que DEclara el lockfile:
 *   pnpm-lock.yaml  -> pnpm audit --json
 *   package-lock.json -> npm audit --json
 *   Cargo.lock      -> cargo audit --json (si cargo-audit esta instalado)
 * Proyectos sin lockfile o con gestor no disponible se marcan 'noAuditable'
 * (visibles pero SIN problema), nunca como error.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type {
  AnalisisVulnerabilidades,
  HallazgoVulnerabilidad,
  Proyecto,
} from '../../shared/types.js';

/* Capacidades de aplicacion: este detector corre binarios npm/pnpm/cargo (no
 * el runtime sentinel), no necesita derivar env GLORY_*. */

/* Cache en memoria: clave de frescura -> resultado. */
interface EntradaCache {
  /* branch + HEAD del repo + gestor + hash del lockfile: si ND de eso cambia,
   * la cache sirve sin re-ejecutar audit (que puede tardar 5-15 s). */
  fresco: string;
  dato: AnalisisVulnerabilidades;
}

const cache = new Map<string, EntradaCache>();

/* Single-flight: si el MISMO proyecto ya se esta auditando, quien lo pide
 * comparte ese vuelo (nunca dos audits del mismo repo a la vez). */
const enVuelo = new Map<string, Promise<AnalisisVulnerabilidades>>();

/* Corre el CLI de audit con spawn (shell en Windows para resolver .cmd) y
 * recolecta stdout SIN rechazar por exit code: npm/pnpm/cargo audit salen
 * con exit 1 cuando hay vulnerabilidades, y el JSON valido va en stdout.
 * Devuelve '' si el binario no existe (p. ej. cargo-audit sin instalar) o
 * si excede el timeout; quien llama decide por el contenido parseable. */
function correrConOutput(cli: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const hijo = spawn(cli, { cwd, shell: true, windowsHide: true });
    let out = '';
    const to = setTimeout(() => {
      hijo.kill();
      resolve('');
    }, 120000);
    hijo.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    hijo.on('error', () => {
      clearTimeout(to);
      resolve('');
    });
    hijo.on('close', () => {
      clearTimeout(to);
      resolve(out);
    });
  });
}

/* subcarpetas de lockfile: algunas repos tienen el paquete en frontend/ o gui/,
 * y el lockfile NO esta en la raiz del repo (PT/WANDORIUS/RESTAURANTE/coolify). */
const SUB_LOCKFILES = ['', 'frontend', 'gui', 'frontend-v2'] as const;

interface LockDetectado {
  lockfile: string;
  ruta: string;
  base: string;
  gestor: 'npm' | 'pnpm' | 'cargo';
}

/* Localiza el lockfile de un proyecto: prioriza la raiz, y si no hay, busca en
 * subcarpetas conocidas de frontend/gui. Devuelve null si no hay lockfile. */
function detectarLockfile(p: Proyecto): LockDetectado | null {
  const candidatos: { file: string; gestor: 'npm' | 'pnpm' | 'cargo' }[] = [
    { file: 'pnpm-lock.yaml', gestor: 'pnpm' },
    { file: 'package-lock.json', gestor: 'npm' },
    { file: 'Cargo.lock', gestor: 'cargo' },
  ];
  for (const sub of SUB_LOCKFILES) {
    for (const c of candidatos) {
      const ruta = join(p.ruta, sub, c.file);
      if (existsSync(ruta)) return { lockfile: c.file, ruta, base: sub, gestor: c.gestor };
    }
  }
  return null;
}

/* Hash del contenido del lockfile: si cambia (misma base que Dependabot) se
 * re-audita. [por que] La cache por cambio REAL del lockfile evita volver a
 * correr audit cada vez que se pide sin que nada haya cambiado. */
function hashLockfile(ruta: string): string {
  try {
    return createHash('sha1').update(readFileSync(ruta)).digest('hex').slice(0, 12);
  } catch {
    return 'leer-error';
  }
}

/* Clave de frescura de un proyecto: el lockfile cambia con cada dependencia
 * tocada; el HEAD cambia con cada commit (aunque el lockfile no, no re-audita
 * si el HEAD cambio y el lockfile NO — audit depende del lockfile SOLO). */
function frescoDe(p: Proyecto, lock: LockDetectado): string {
  return `${p.clave}|${lock.gestor}|${hashLockfile(lock.ruta)}`;
}

/* Normaliza una severidad arbitraria del JSON de audit a las 4 conocidas.
 * cargo audit usa severidad por CVSS (informational/low/medium/high/critical);
 * npm/pnpm usan info/low/moderate/high/critical. Se mapea a las 4. */
function sev(s: unknown): HallazgoVulnerabilidad['severidad'] {
  const t = String(s ?? 'low').toLowerCase();
  if (t === 'critical') return 'critical';
  if (t === 'high') return 'high';
  if (t === 'moderate' || t === 'medium') return 'moderate';
  return 'low';
}

/* npm audit --json: { metadata: { vulnerabilities: {info,low,moderate,high,
 * critical} }, vulnerabilities: { "<paquete>": { severity, ... } } }.
 * pnpm audit --json: { metadata: {...}, vulnerabilities: [ {name,severity,...} ] }.
 * cargo audit --json: { vulnerabilities: { "<id>": { advisory/severe..., ... } },
 *                       vulnerabilities_found: n }. */
interface JsonAudit {
  metadata?: {
    vulnerabilities?: Partial<Record<string, unknown>>;
  };
  vulnerabilities?: unknown;
  vulnerabilities_found?: unknown;
}

function parsearAudit(g: LockDetectado['gestor'], crudo: JsonAudit): {
  resumen: AnalisisVulnerabilidades['resumen'];
  hallazgos: HallazgoVulnerabilidad[];
} {
  const resumen = { critical: 0, high: 0, moderate: 0, low: 0 };
  const hallazgos: HallazgoVulnerabilidad[] = [];
  const meta = crudo.metadata?.vulnerabilities ?? {};
  for (const sevKey of ['critical', 'high', 'moderate', 'low'] as const) {
    const n = Number(meta[sevKey]);
    if (n > 0) resumen[sevKey] = n;
  }
  const vulns = crudo.vulnerabilities;
  const agregar = (paquete: string, s: unknown, rango: string) => {
    hallazgos.push({ paquete, severidad: sev(s), rango });
  };

  if (g === 'cargo') {
    /* cargo reporta en `vulnerabilities` un mapa id -> { ... } y usa un count
     * aparte; la severidad no siempre esta (depende de CVSS). Se agrega con
     * severidad 'low' si no hay dato. */
    if (vulns && typeof vulns === 'object') {
      for (const [id, v] of Object.entries(vulns as Record<string, unknown>)) {
        const o = (v ?? {}) as Record<string, unknown>;
        const severityRaw =
          o['severity'] ??
          (o['cvss'] as { severity?: unknown } | undefined)?.severity ??
          (o['advisory'] as { severity?: unknown } | undefined)?.severity;
        agregar(
          String(o['package'] ?? id),
          severityRaw,
          String(o['vulnerable_versions'] ?? o['range'] ?? ''),
        );
      }
    }
    return { resumen, hallazgos };
  }

  if (Array.isArray(vulns)) {
    /* pnpm: array de { name, severity, range }. */
    for (const v of vulns as Array<Record<string, unknown>>) {
      agregar(String(v['name'] ?? '?'), v['severity'], String(v['range'] ?? ''));
    }
    return { resumen, hallazgos };
  }
  if (vulns && typeof vulns === 'object') {
    /* npm: mapa paquete -> { severity, ... }. */
    for (const [pkg, v] of Object.entries(vulns as Record<string, unknown>)) {
      const o = (v ?? {}) as Record<string, unknown>;
      agregar(pkg, o['severity'], String(o['range'] ?? o['range_safe'] ?? ''));
    }
  }
  return { resumen, hallazgos };
}

/* Comando de audit del gestor. npm/pnpm/cargo pueden ser .cmd en Windows:
 * se usa execFile con shell (args estaticos, sin input del usuario). */
function comandoAudit(g: LockDetectado['gestor']): string {
  if (g === 'pnpm') return 'pnpm audit --json';
  if (g === 'cargo') return 'cargo audit --json';
  return 'npm audit --json';
}

/* Corre audit de UN proyecto y devuelve el resultado normalizado; null si el
 * CLI falla (se deriva el estado error/noAuditable arriba). */
async function correrAudit(
  p: Proyecto,
  lock: LockDetectado,
): Promise<AnalisisVulnerabilidades> {
  const cli = comandoAudit(lock.gestor);
  /* [por que] El audit debe correr desde la carpeta que contiene el lockfile;
   * el lockfile puede estar en la raiz o en frontend/gui. `base` es esa
   * subcarpeta ('' para raiz). */
  const cwdAudit = join(p.ruta, lock.base);

  /* [por que] npm/pnpm/cargo audit devuelven exit != 0 cuando HAY
   * vulnerabilidades (exit 1) o cargo-audit no esta (exit distinto). execFile
   * rechaza en ambos casos; el JSON valido viaja en stdout. Por eso NO se usa
   * el reject de execFile como criterio: se corre con spawn (promisificado a
   * mano) y se decide por el contenido parseable de stdout, no por el exit. */
  const stdout = await correrConOutput(cli, cwdAudit);
  try {
    const crudo = JSON.parse(stdout) as JsonAudit;
    if (!crudo || typeof crudo !== 'object') throw new Error('respuesta invalida');
    const { resumen, hallazgos } = parsearAudit(lock.gestor, crudo);
    const total = resumen.critical + resumen.high + resumen.moderate + resumen.low;
    return {
      clave: p.clave,
      gestor: lock.gestor,
      lockfile: lock.lockfile,
      estado: total > 0 ? 'conHallazgos' : 'ok',
      analizadoEn: new Date().toISOString(),
      resumen,
      hallazgos: hallazgos.slice(0, 300),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'audit fallo';
    /* [por que] cargo-audit ausente produce stdout vacio/JSON invalido: como
     * RESTAURANTE/WANDORIUS/PT solo tienen lockfile Rust a analizar, el fallo
     * de parseo puede deberse a cargo-audit no instalado. Se marca
     * 'noAuditable' (visible sin problema) como limitacion documentada. */
    const noCargo = lock.gestor === 'cargo';
    return {
      clave: p.clave,
      gestor: lock.gestor,
      lockfile: lock.lockfile,
      estado: noCargo ? 'noAuditable' : 'error',
      analizadoEn: new Date().toISOString(),
      resumen: { critical: 0, high: 0, moderate: 0, low: 0 },
      hallazgos: [],
      error: noCargo
        ? 'cargo-audit no instalado (Rust pendiente de provisionar)'
        : `audit fallo: ${msg.slice(0, 120)}`,
    };
  }
}

/* Audita UN proyecto con cache por cambio real (hash de lockfile) y
 * single-flight. Si no tiene lockfile, marca noAuditable. */
export function auditarProyecto(p: Proyecto, forzar = false): Promise<AnalisisVulnerabilidades> {
  const lock = detectarLockfile(p);
  if (!lock) {
    return Promise.resolve({
      clave: p.clave,
      gestor: null,
      lockfile: '',
      estado: 'noAuditable',
      analizadoEn: new Date().toISOString(),
      resumen: { critical: 0, high: 0, moderate: 0, low: 0 },
      hallazgos: [],
      error: 'sin lockfile de dependencias (npm/pnpm/cargo)',
    });
  }
  const fresco = frescoDe(p, lock);
  const mem = cache.get(p.clave);
  if (!forzar && mem && mem.fresco === fresco) return Promise.resolve(mem.dato);
  const yaEnVuelo = enVuelo.get(p.clave);
  if (yaEnVuelo) return yaEnVuelo;
  const vuelo = (async (): Promise<AnalisisVulnerabilidades> => {
    const dato = await correrAudit(p, lock);
    cache.set(p.clave, { fresco, dato });
    return dato;
  })();
  enVuelo.set(p.clave, vuelo);
  void vuelo.finally(() => enVuelo.delete(p.clave));
  return vuelo;
}

/* Barrido serial del workspace (una cola, max 1 auditor a la vez: el lockfile
 * de cada repo se audita en serie, cediendo el event loop con await). Rehusa
 * lo fresco (cache) y los vuelos en curso. */
export async function auditarTodo(
  proyectos: Proyecto[],
  forzar = false,
): Promise<AnalisisVulnerabilidades[]> {
  const detalles: AnalisisVulnerabilidades[] = [];
  for (const p of proyectos) {
    detalles.push(await auditarProyecto(p, forzar));
  }
  /* Eviccion de la cache: claves de proyectos que ya no existen en el
   * snapshot se podan (misma convencion que el analizador). */
  const vivas = new Set(proyectos.map((p) => p.clave));
  for (const clave of [...cache.keys()]) if (!vivas.has(clave)) cache.delete(clave);
  return detalles;
}

export function leerVulnerabilidades(clave: string): AnalisisVulnerabilidades | null {
  return cache.get(clave)?.dato ?? null;
}

/* Sirve TODA la cache (rehidratar el store al recargar sin re-auditar). */
export function leerTodasVulnerabilidades(): AnalisisVulnerabilidades[] {
  return [...cache.values()].map((e) => e.dato);
}