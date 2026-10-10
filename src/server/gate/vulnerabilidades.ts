/* Detector de vulnerabilidades de dependencias por proyecto (plan
 * vulnerabilidades-consola 308A-4, V1). [por que] El usuario pidio que las
 * vulnerabilidades aparezcan SOLAS en la consola del manager, sin depender de
 * la UI de GitHub por repo. Es homologo a `analizador.ts` (analisis sentinel)
 * pero para dependencias: reutiliza el mismo patron de cola serial +
 * single-flight + cache por cambio real + timeout.
 *
 * Fuentes: el CLI de audit del gestor de cada lockfile:
 *   pnpm-lock.yaml  -> pnpm audit --json (o corepack pnpm si pnpm no esta en PATH)
 *   package-lock.json -> npm audit --json
 *   Cargo.lock      -> cargo audit --json (si cargo-audit esta instalado)
 * Un proyecto puede tener varios lockfile (WANDORIUS: raiz, frontend/,
 * glory-rs/): se auditan todos y se agregan. Los crates de Cargo.lock que no
 * alcanzan el build (cargo tree -i) no cuentan como hallazgo. Proyectos sin
 * lockfile, o con algun lockfile no auditable, se marcan 'noAuditable'
 * (visibles pero SIN problema), nunca como error.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { compartirVuelo } from './vuelo.js';
import { contar, esNoAlcanzable, nombrePaqueteValido, parsearAudit } from './vulnerabilidades-parseo.js';
import type { JsonAudit } from './vulnerabilidades-parseo.js';
import type {
  AnalisisVulnerabilidades,
  HallazgoVulnerabilidad,
  Proyecto,
} from '../../shared/types.js';

/* Cache en memoria: clave de frescura -> resultado. */
interface EntradaCache {
  /* Lockfiles del proyecto con su hash: si cambia alguno, la cache no sirve y
   * se re-audita (el audit puede tardar 5-15 s). */
  fresco: string;
  dato: AnalisisVulnerabilidades;
}

const cache = new Map<string, EntradaCache>();

/* Single-flight: si el MISMO proyecto ya se esta auditando, quien lo pide
 * comparte ese vuelo (nunca dos audits del mismo repo a la vez). */
const enVuelo = new Map<string, Promise<AnalisisVulnerabilidades>>();

/* Resultado crudo de un comando de shell. `codigo` es null si no arranco o
 * excedio el timeout. */
interface Ejecucion {
  stdout: string;
  codigo: number | null;
}

/* Ejecuta un comando de shell y devuelve stdout y exit code SIN rechazar por
 * exit code: npm/pnpm/cargo audit salen con exit 1 cuando hay vulnerabilidades,
 * y cargo tree sale != 0 si falta un crate. [por que] npm/pnpm son shims .cmd
 * en Windows que Node no puede lanzar con shell:false (EINVAL), asi que va por
 * cmd.exe /d /s /c. El comando lo arma SOLO este modulo (texto estatico o nombre
 * de crate validado con nombrePaqueteValido): no hay input externo en la linea,
 * asi que no hay inyeccion de shell. */
function ejecutar(comando: string, cwd: string): Promise<Ejecucion> {
  return new Promise((resolve) => {
    const hijo = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', comando], {
      cwd,
      windowsHide: true,
      /* [por que] corepack pregunta en consola antes de descargar pnpm; sin
       * consola esa pregunta colgaria el audit. */
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    });
    let out = '';
    const to = setTimeout(() => {
      hijo.kill();
      resolve({ stdout: out, codigo: null });
    }, 120000);
    hijo.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    hijo.on('error', () => {
      clearTimeout(to);
      resolve({ stdout: '', codigo: null });
    });
    hijo.on('close', (codigo) => {
      clearTimeout(to);
      resolve({ stdout: out, codigo });
    });
  });
}

/* pnpm no siempre esta en PATH (en esta maquina no lo esta; corepack si). Se
 * resuelve una vez y se recuerda el exito. Un fallo no se cachea: el siguiente
 * audit reintenta (p. ej. si corepack tardo en descargar pnpm). */
const VERSION_SEMVER = /^\d+\.\d+\.\d+/;
let cliPnpmResuelto: string | null = null;

async function resolverCliPnpm(cwd: string): Promise<string | null> {
  if (cliPnpmResuelto) return cliPnpmResuelto;
  const directo = await ejecutar('pnpm --version', cwd);
  if (directo.codigo === 0 && VERSION_SEMVER.test(directo.stdout.trim())) {
    cliPnpmResuelto = 'pnpm audit --json';
  } else {
    const via = await ejecutar('corepack pnpm --version', cwd);
    if (via.codigo === 0 && VERSION_SEMVER.test(via.stdout.trim())) {
      cliPnpmResuelto = 'corepack pnpm audit --json';
    }
  }
  return cliPnpmResuelto;
}

/* Carpetas donde buscar lockfile. Lista fija (no recorrido): excluye a proposito
 * las copias vendored (tools/, .quality-tools/, .sentinel/), que no son deps del
 * proyecto. [por que] WANDORIUS tiene lockfiles en la raiz, en frontend/ y en
 * glory-rs/; antes solo se auditaba el primero que aparecia. */
const BASES_LOCKFILE = ['', 'frontend', 'gui', 'frontend-v2', 'glory-rs'] as const;

interface LockDetectado {
  /* Ruta relativa al proyecto para mostrar, p. ej. `frontend/package-lock.json`. */
  lockfile: string;
  ruta: string;
  /* Subcarpeta donde se ejecuta el audit ('' para la raiz). */
  base: string;
  gestor: 'npm' | 'pnpm' | 'cargo';
}

/* Localiza TODOS los lockfile del proyecto. Por carpeta: un lockfile JS (pnpm
 * gana a npm si ambos existen) y su Cargo.lock, si lo hay. `existe` se inyecta
 * para poder probarlo sin disco. */
export function detectarLockfiles(
  rutaProyecto: string,
  existe: (ruta: string) => boolean = existsSync,
): LockDetectado[] {
  const hallados: LockDetectado[] = [];
  for (const base of BASES_LOCKFILE) {
    const hay = (file: string) => existe(join(rutaProyecto, base, file));
    const elegidos: { file: string; gestor: LockDetectado['gestor'] }[] = [];
    if (hay('pnpm-lock.yaml')) elegidos.push({ file: 'pnpm-lock.yaml', gestor: 'pnpm' });
    else if (hay('package-lock.json')) elegidos.push({ file: 'package-lock.json', gestor: 'npm' });
    if (hay('Cargo.lock')) elegidos.push({ file: 'Cargo.lock', gestor: 'cargo' });
    for (const e of elegidos) {
      hallados.push({
        lockfile: base ? `${base}/${e.file}` : e.file,
        ruta: join(rutaProyecto, base, e.file),
        base,
        gestor: e.gestor,
      });
    }
  }
  return hallados;
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

/* Clave de frescura del proyecto: cambia si cambia cualquiera de sus lockfile.
 * [por que] El HEAD no entra: audit depende solo de los lockfile. */
function frescoDe(p: Proyecto, locks: LockDetectado[]): string {
  return `${p.clave}|${locks.map((l) => `${l.lockfile}@${hashLockfile(l.ruta)}`).join('|')}`;
}

/* Comando de audit del gestor. Para pnpm puede no haber CLI: devuelve null. */
async function cliDeAudit(g: LockDetectado['gestor'], cwd: string): Promise<string | null> {
  if (g === 'pnpm') return resolverCliPnpm(cwd);
  return g === 'cargo' ? 'cargo audit --json' : 'npm audit --json';
}

/* Un hallazgo de cargo solo cuenta si el crate alcanza el build. `memo` es de
 * UNA auditoria: varios advisories del mismo crate cuestan un solo cargo tree. */
async function alcanzable(
  cwd: string,
  paquete: string,
  memo: Map<string, boolean>,
): Promise<boolean> {
  if (!nombrePaqueteValido(paquete)) return true;
  const previo = memo.get(paquete);
  if (previo !== undefined) return previo;
  const r = await ejecutar(`cargo tree -i ${paquete} --offline -e normal,build --target all`, cwd);
  const si = !esNoAlcanzable(r.codigo, r.stdout);
  memo.set(paquete, si);
  return si;
}

/* Parte de un análisis sin datos: sin lockfile, CLI ausente o CLI fallido. */
function sinDatos(
  base: Pick<AnalisisVulnerabilidades, 'clave' | 'gestor' | 'lockfile'>,
  estado: 'noAuditable' | 'error',
  error: string,
): AnalisisVulnerabilidades {
  return {
    ...base,
    estado,
    analizadoEn: new Date().toISOString(),
    resumen: { critical: 0, high: 0, moderate: 0, low: 0 },
    hallazgos: [],
    noAlcanzables: [],
    error,
  };
}

/* Corre audit de UN lockfile y devuelve su parte normalizada. La cache es por
 * proyecto (auditarProyecto), no por lockfile. */
async function correrAudit(p: Proyecto, lock: LockDetectado): Promise<AnalisisVulnerabilidades> {
  const base = { clave: p.clave, gestor: lock.gestor, lockfile: lock.lockfile };
  /* [por que] El audit debe correr desde la carpeta que contiene el lockfile;
   * `base` es esa subcarpeta ('' para raiz). */
  const cwdAudit = join(p.ruta, lock.base);
  const cli = await cliDeAudit(lock.gestor, cwdAudit);
  if (!cli) {
    return sinDatos(base, 'noAuditable', 'pnpm no disponible (ni pnpm ni corepack en PATH)');
  }

  /* [por que] npm/pnpm/cargo audit devuelven exit != 0 cuando HAY vulnerabilidades
   * (exit 1) o cargo-audit no esta. El JSON valido viaja en stdout, asi que la
   * decision se toma por el contenido parseable, no por el exit code. */
  const { stdout } = await ejecutar(cli, cwdAudit);
  try {
    const crudo = JSON.parse(stdout) as JsonAudit;
    if (!crudo || typeof crudo !== 'object') throw new Error('respuesta invalida');
    let { resumen, hallazgos } = parsearAudit(lock.gestor, crudo);
    const noAlcanzables: HallazgoVulnerabilidad[] = [];
    if (lock.gestor === 'cargo') {
      const memo = new Map<string, boolean>();
      const alcanzan: HallazgoVulnerabilidad[] = [];
      for (const h of hallazgos) {
        if (await alcanzable(cwdAudit, h.paquete, memo)) alcanzan.push(h);
        else noAlcanzables.push(h);
      }
      hallazgos = alcanzan;
      resumen = contar(alcanzan);
    }
    const total = resumen.critical + resumen.high + resumen.moderate + resumen.low;
    return {
      ...base,
      estado: total > 0 ? 'conHallazgos' : 'ok',
      analizadoEn: new Date().toISOString(),
      resumen,
      hallazgos: hallazgos.slice(0, 300).map((h) => ({ ...h, origen: lock.lockfile })),
      noAlcanzables: noAlcanzables.map((h) => ({ ...h, origen: lock.lockfile })),
    };
  } catch (err) {
    /* [por que] cargo-audit ausente produce stdout vacio o no-JSON. Se marca
     * 'noAuditable' (visible sin problema) como limitacion documentada. */
    if (lock.gestor === 'cargo') {
      return sinDatos(base, 'noAuditable', 'cargo-audit no disponible (no instalado o sin salida)');
    }
    const msg = stdout.trim() === '' ? 'sin salida del CLI' : err instanceof Error ? err.message : 'audit fallo';
    return sinDatos(base, 'error', `audit fallo: ${msg.slice(0, 120)}`);
  }
}

const SEVERIDADES = ['critical', 'high', 'moderate', 'low'] as const;

/* Une las partes de un proyecto (una por lockfile) en un solo análisis. Estado,
 * de mayor a menor: conHallazgos > error > noAuditable (si alguna parte no se
 * pudo auditar) > ok. [por que] conHallazgos gana a error: las vulnerabilidades
 * ya obtenidas son reales y no deben esconderse porque otra parte fallara; el
 * fallo queda en `error`. */
export function agregarAnalisis(
  clave: string,
  partes: AnalisisVulnerabilidades[],
): AnalisisVulnerabilidades {
  const resumen = { critical: 0, high: 0, moderate: 0, low: 0 };
  const hallazgos: HallazgoVulnerabilidad[] = [];
  const noAlcanzables: HallazgoVulnerabilidad[] = [];
  const avisos: string[] = [];
  for (const p of partes) {
    for (const s of SEVERIDADES) resumen[s] += p.resumen[s];
    hallazgos.push(...p.hallazgos);
    noAlcanzables.push(...(p.noAlcanzables ?? []));
    if (p.error) avisos.push(`${p.lockfile}: ${p.error}`);
  }
  const estados = partes.map((p) => p.estado);
  const estado: AnalisisVulnerabilidades['estado'] = estados.includes('conHallazgos')
    ? 'conHallazgos'
    : estados.includes('error')
      ? 'error'
      : estados.includes('noAuditable')
        ? 'noAuditable'
        : 'ok';
  return {
    clave,
    gestor: partes.find((p) => p.gestor)?.gestor ?? null,
    lockfile: partes.map((p) => p.lockfile).join(', '),
    estado,
    analizadoEn: new Date().toISOString(),
    resumen,
    hallazgos: hallazgos.slice(0, 300),
    noAlcanzables,
    ...(avisos.length ? { error: avisos.join('; ').slice(0, 300) } : {}),
  };
}

/* Audita UN proyecto con cache por cambio real (hash de sus lockfile) y
 * single-flight. Sin lockfile, marca noAuditable. */
export function auditarProyecto(p: Proyecto, forzar = false): Promise<AnalisisVulnerabilidades> {
  const locks = detectarLockfiles(p.ruta);
  if (locks.length === 0) {
    return Promise.resolve(
      sinDatos(
        { clave: p.clave, gestor: null, lockfile: '' },
        'noAuditable',
        'sin lockfile de dependencias (npm/pnpm/cargo)',
      ),
    );
  }
  const fresco = frescoDe(p, locks);
  const mem = cache.get(p.clave);
  if (!forzar && mem && mem.fresco === fresco) return Promise.resolve(mem.dato);
  return compartirVuelo(enVuelo, p.clave, async (): Promise<AnalisisVulnerabilidades> => {
    /* En serie: un audit a la vez por proyecto, como el barrido del workspace. */
    const partes: AnalisisVulnerabilidades[] = [];
    for (const lock of locks) partes.push(await correrAudit(p, lock));
    const dato = agregarAnalisis(p.clave, partes);
    cache.set(p.clave, { fresco, dato });
    return dato;
  });
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
