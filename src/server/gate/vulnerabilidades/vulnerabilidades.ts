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
 *   Cargo.lock      -> cargo audit --json
 * Los tres corren en la VPS 89 si el proyecto se analiza alli (ver
 * auditoria-remota.ts) y en el portatil si no: el manager funciona sin VPS.
 * Un proyecto puede tener varios lockfile (WANDORIUS: raiz, frontend/,
 * glory-rs/): se auditan todos y se agregan. Los crates de Cargo.lock que no
 * alcanzan el build (cargo tree -i) no cuentan como hallazgo. Proyectos sin
 * lockfile, o con algun lockfile no auditable, se marcan 'noAuditable'
 * (visibles pero SIN problema), nunca como error.
 *
 * Este modulo solo orquesta (cache, vuelos, lockfiles). El resto vive aparte:
 * cómo se lanza cada CLI en `audit/ejecucion.ts`, la unión de partes
 * en `audit/agregado.ts` y el parseo en `audit/parseo.ts`.
 */
import { join } from 'node:path';
import { compartirVuelo } from '../vuelo.js';
import { ejecutarAuditRemoto } from '../auditoria-remota.js';
import {
  contar,
  esNoAlcanzable,
  nombrePaqueteValido,
  parsearAudit,
} from './audit/parseo.js';
import type { JsonAudit } from './audit/parseo.js';
import { enTaller, prepararRemoto } from './audit/remoto.js';
import { detectarLockfiles, frescoDe } from './lockfiles.js';
import {
  guardarVulnerabilidades,
  podarVulnerabilidades,
  vulnerabilidadesFrescas,
} from './almacen.js';
import type { LockDetectado } from './lockfiles.js';
import { agregarAnalisis, sinDatos } from './audit/agregado.js';
import { cliDeAudit, ejecutar } from './audit/ejecucion.js';
import type { Corredor } from './audit/ejecucion.js';
import type {
  AnalisisVulnerabilidades,
  HallazgoVulnerabilidad,
  Proyecto,
} from '../../../shared/types.js';

/* Single-flight: si el MISMO proyecto ya se esta auditando, quien lo pide
 * comparte ese vuelo (nunca dos audits del mismo repo a la vez). */
const enVuelo = new Map<string, Promise<AnalisisVulnerabilidades>>();

/* Un hallazgo de cargo solo cuenta si el crate alcanza el build. `memo` es de
 * UNA auditoria: varios advisories del mismo crate cuestan un solo cargo tree.
 * [16AA-11] Sin `--offline`: la cache de registro de la 89 no cubre todos los
 * targets y `--target all` fallaba pidiendo crates que no tenia. Si el comando
 * falla, `esNoAlcanzable` da falso y el crate CUENTA: fallo cerrado, mas vale
 * sobrar que esconder una vulnerabilidad real. */
async function alcanzable(
  correr: Corredor,
  paquete: string,
  memo: Map<string, boolean>,
): Promise<boolean> {
  if (!nombrePaqueteValido(paquete)) return true;
  const previo = memo.get(paquete);
  if (previo !== undefined) return previo;
  const r = await correr(`cargo tree -i ${paquete} -e normal,build --target all`);
  const si = !esNoAlcanzable(r.codigo, r.stdout);
  memo.set(paquete, si);
  return si;
}

/* Corre audit de UN lockfile y devuelve su parte normalizada. La cache es por
 * proyecto (auditarProyecto), no por lockfile. */
async function correrAudit(p: Proyecto, lock: LockDetectado, enLa89: boolean): Promise<AnalisisVulnerabilidades> {
  const base = { clave: p.clave, gestor: lock.gestor, lockfile: lock.lockfile };
  /* [por que] El audit debe correr desde la carpeta que contiene el lockfile;
   * `base` es esa subcarpeta ('' para raiz). */
  const cwdAudit = join(p.ruta, lock.base);

  /* [por que] El analisis del taller va a la 89 (AGENTS §7): el audit es analisis,
   * asi que con `modoAnalisis === 'taller'` corre alli, igual que Sentinel y
   * VarSense. Solo viaja lo que el gestor necesita para resolver su lockfile. Si el
   * envio falla, queda en 'error' con su motivo y NO se reintenta en local: auditar
   * en el portatil es carga pesada (AGENTS §1), igual que en `analizador.ts`. Sin
   * taller configurado el audit corre en local, que es el modo sin VPS. */
  const falloRemoto = enLa89 ? await prepararRemoto(p.ruta, lock.gestor) : null;
  if (falloRemoto !== null) {
    return sinDatos(base, 'error', `audit en el taller no arrancó: ${falloRemoto.slice(0, 120)}`);
  }
  const remoto = enLa89;

  const cli = await cliDeAudit(lock.gestor, cwdAudit, remoto);
  if (!cli) {
    return sinDatos(base, 'noAuditable', 'pnpm no disponible (ni pnpm ni corepack en PATH)');
  }

  const correr: Corredor = remoto
    ? (comando) => ejecutarAuditRemoto(comando, p.ruta, lock.base, lock.gestor)
    : (comando) => ejecutar(comando, cwdAudit);

  /* [por que] npm/pnpm/cargo audit devuelven exit != 0 cuando HAY vulnerabilidades
   * (exit 1) o cargo-audit no esta. El JSON valido viaja en stdout, asi que la
   * decision se toma por el contenido parseable, no por el exit code. */
  const { stdout } = await correr(cli);
  try {
    const crudo = JSON.parse(stdout) as JsonAudit;
    if (!crudo || typeof crudo !== 'object') throw new Error('respuesta invalida');
    let { resumen, hallazgos } = parsearAudit(lock.gestor, crudo);
    const noAlcanzables: HallazgoVulnerabilidad[] = [];
    if (lock.gestor === 'cargo') {
      const memo = new Map<string, boolean>();
      const alcanzan: HallazgoVulnerabilidad[] = [];
      for (const h of hallazgos) {
        if (await alcanzable(correr, h.paquete, memo)) alcanzan.push(h);
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
      const donde = remoto ? 'en la 89' : 'en local';
      return sinDatos(base, 'noAuditable', `cargo-audit no disponible ${donde} (no instalado o sin salida)`);
    }
    const msg = stdout.trim() === '' ? 'sin salida del CLI' : err instanceof Error ? err.message : 'audit fallo';
    return sinDatos(base, 'error', `audit fallo: ${msg.slice(0, 120)}`);
  }
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
  if (!forzar) {
    const guardado = vulnerabilidadesFrescas(p.clave, fresco);
    if (guardado) return Promise.resolve(guardado);
  }
  return compartirVuelo(enVuelo, p.clave, async (): Promise<AnalisisVulnerabilidades> => {
    /* En serie: un audit a la vez por proyecto, como el barrido del workspace. */
    const partes: AnalisisVulnerabilidades[] = [];
    const enLa89 = enTaller(p.clave);
    for (const lock of locks) partes.push(await correrAudit(p, lock, enLa89));
    const dato = agregarAnalisis(p.clave, partes);
    guardarVulnerabilidades(p.clave, fresco, dato);
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
  podarVulnerabilidades(new Set(proyectos.map((p) => p.clave)));
  return detalles;
}
