/* Guarda de los gemelos TS/MJS: cada módulo de `src/server/plataforma` tiene su copia en
 * `scripts/shared` para los scripts que no pueden cargar TypeScript. [por que] Dos copias
 * sin prueba divergen en silencio (17AA-5): un cambio de regla en una no llega a la otra.
 * Este test compara las dos con el mismo entorno y falla si cambian los nombres o los valores. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as binariosTs from './sistema/binarios.js';
import * as puertosTs from './sistema/puertos.js';
import * as areaTs from './area.js';
import { raizTemporales as raizTemporalesTs } from './sistema/temporales.js';

/* Importa el gemelo .mjs por URL: TypeScript no tiene su tipo y no hace falta, porque solo se compara. */
async function gemelo(nombre: string): Promise<Record<string, unknown>> {
  return (await import(new URL(`../../../scripts/shared/${nombre}`, import.meta.url).href)) as Record<string, unknown>;
}

/* Cada export del TS debe existir en el gemelo y valer lo mismo. El gemelo puede tener extras
 * (p. ej. `URL_API` solo en .mjs), así que se comprueba que el TS no pierda nada. */
function mismosValores(nombreModulo: string, ts: object, mjs: Record<string, unknown>): void {
  for (const nombre of Object.keys(ts)) {
    assert.ok(nombre in mjs, `${nombreModulo}: falta ${nombre} en el gemelo .mjs`);
    assert.deepEqual(mjs[nombre], (ts as Record<string, unknown>)[nombre], `${nombreModulo}.${nombre}`);
  }
}

test('binarios: mismos nombres y mismos valores que el gemelo .mjs', async () => {
  mismosValores('binarios', binariosTs, await gemelo('binarios.mjs'));
});

test('puertos: mismos nombres y mismos valores que el gemelo .mjs', async () => {
  mismosValores('puertos', puertosTs, await gemelo('puertos.mjs'));
});

test('temporales: la misma regla con entornos distintos (Windows, Linux, WM_TMP)', async () => {
  const { raizTemporales: raizMjs } = (await gemelo('rutas.mjs')) as { raizTemporales: typeof raizTemporalesTs };
  const casos: [NodeJS.ProcessEnv, NodeJS.Platform][] = [
    [{}, 'win32'],
    [{}, 'linux'],
    [{ WM_TMP: ' /var/x ' }, 'linux'],
    [{ WM_TMP: 'D:/tmp' }, 'win32'],
  ];
  for (const [env, plataforma] of casos) {
    assert.equal(raizMjs(env, plataforma, '/casa'), raizTemporalesTs(env, plataforma, '/casa'), JSON.stringify({ env, plataforma }));
  }
});

test('area: los papeles leídos por el TS y por el .mjs son los mismos', async () => {
  const mjs = await gemelo('area.mjs');
  assert.deepEqual((mjs.papelesDeArea as () => unknown)(), areaTs.papelesDeArea());
});
