#!/usr/bin/env node
/* sync-gate-schema: detecta desalineacion entre el schema de config del runtime
 * sentinel instalado y la curacion actual (ESQUEMA_SENTINEL en shared/gate).
 *
 * [por que] El schema de config NO es derivable en runtime (config.d.ts es
 * compile-time, ver PLAN-gate-dinamico.md §1). Lo unico que garantiza que la
 * curacion siga al dia es COMPARARLA contra la fuente canónica: el
 * `config.d.ts` de la version instalada. Este script es la guarda: si el
 * runtime gana/quita campos o cambia su forma, lo reporta y sale != 0 para
 * poder colgarlo de CI/guard. NUNCA modifica la curacion ni el JSON de ningun
 * proyecto: solo reporta; el alineado manual queda documentado.
 *
 * Uso:  pnpm sync:gate            (corre contra el runtime EN USO: checkout
 *                                  compartido del area > versiones instaladas)
 *       pnpm sync:gate --json
 *       pnpm sync:gate --dts <archivo>  (comparar contra un .d.ts especifico;
 *                                        util en CI/tests; ignora la version
 *                                        instalada)
 *
 * Exit codes:
 *   0  alineado (o solo 'sobrantes' de curacion: avanza, no rompe)
 *   1  desalineacion : FALTAN campos del runtime que la curacion no cubre,
 *      o CAMBIO de forma/ tipo en uno ya cubierto
 *   2  variacion de version del runtime respecto de la curacion */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { raizVersiones, checkoutSentinel, versionRuntime, versionSentinel, VERSION_CURACION_SENTINEL } from '../../src/server/gate/herramientas/proveedor.js';
// Reparto: parseo puro en syncGateParseo.mjs, comparacion en syncGateComparar.mjs y lectura del .d.ts en syncGateLectura.mjs.
import { leerEsquemaCuracion } from './syncGateParseo.mjs';
import { compararEsquemas } from './syncGateComparar.mjs';
import { leerEsquemaRuntime } from './syncGateLectura.mjs';


/* ------------------------------------------------------------------ *
 *  Reporte y salida
 * ------------------------------------------------------------------ */

function main() {
  const useJson = process.argv.includes('--json');
  const idxDts = process.argv.indexOf('--dts');
  const dtsArg = idxDts >= 0 ? process.argv[idxDts + 1] : null;
  /* Runtime EN USO: el checkout compartido del area (el mismo artefacto que
   * ejecuta el analisis del panel y el gate de los proyectos) y, si no esta
   * provisionado, la version instalada mas alta. [por que] 2026-09-10: el
   * script resolvia solo `RAIZ_VERSIONS`, que tenia 0.7.4 mientras el runtime
   * en uso era 0.7.8: la guarda comparaba la curacion contra un `config.d.ts`
   * que ya no se ejecuta. Con `--dts` explicito se respeta lo pedido. */
  const enUso = (() => {
    const base = checkoutSentinel();
    if (!base) return null;
    const dts = join(base, 'out', 'core', 'config.d.ts');
    if (!existsSync(dts)) return null;
    return { version: versionSentinel() ?? '—', dts };
  })();
  const version = dtsArg ? '—' : enUso?.version ?? versionRuntime();
  const dtsPath = dtsArg || enUso?.dts || (version ? join(raizVersiones(), version, 'out', 'core', 'config.d.ts') : null);

  const reporte = { versionRuntime: version, versionCuracion: VERSION_CURACION_SENTINEL, problemas: [] };

  if (!dtsPath || !existsSync(dtsPath)) {
    reporte.error = `no hay config.d.ts del runtime (version ${version ?? 'ninguna'}). Esperaba: ${dtsPath}`;
    if (useJson) {
      console.log(JSON.stringify(reporte, null, 2));
      return 1;
    }
    console.error(`no hay config.d.ts del runtime (${version ?? 'ninguna'}).`);
    console.error(`ruta esperada: ${dtsPath}`);
    return 1;
  }

  const rt = leerEsquemaRuntime(dtsPath, 'SentinelConfigFile');
  const cu = leerEsquemaCuracion();
  if (!rt) return 1;

  const problemas = compararEsquemas(rt, cu);

  if (version !== VERSION_CURACION_SENTINEL) {
    problemas.unshift({
      tipo: 'version',
      ruta: '',
      rt: version,
      cu: VERSION_CURACION_SENTINEL,
    });
  }

  reporte.problemas = problemas;

  if (useJson) {
    console.log(JSON.stringify(reporte, null, 2));
  } else {
    console.log(`runtime sentinel  : ${version ?? '—'}`);
    console.log(`curacion sentinel : ${VERSION_CURACION_SENTINEL}`);
    console.log('');
    if (!problemas.length) {
      console.log('OK: la curacion ESQUEMA_SENTINEL esta alineada con el runtime.');
      return 0;
    }
    for (const p of problemas) {
      if (p.tipo === 'version') console.log(`AVISO version: curada contra ${p.cu}, runtime ${p.rt} -> ejecutar sync/realinear`);
      else if (p.tipo === 'falta') console.log(`FALTA  ${p.ruta || '<raiz>'}  (runtime: ${p.rt}) -> la curacion no lo cubre`);
      else if (p.tipo === 'sobra') console.log(`SOBRA  ${p.ruta}  (curacion: ${p.cu}) -> campo de mas en la curacion`);
      else if (p.tipo === 'cambio') console.log(`CAMBIO ${p.ruta}  (runtime: ${p.rt} / curacion: ${p.cu}) -> forma o tipo distinto`);
    }
  }

  const criticos = problemas.some((p) => p.tipo === 'falta' || p.tipo === 'cambio');
  const versionDesalineada = problemas.some((p) => p.tipo === 'version');
  if (criticos) return 1;
  if (versionDesalineada) return 2;
  return 0;
}

process.exit(main());