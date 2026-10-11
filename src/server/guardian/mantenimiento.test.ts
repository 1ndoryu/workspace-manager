/* Test del mantenimiento del Guardián (10AA-2 F11.4, «Mantenimiento»). Se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/guardian/mantenimiento.test.ts`.
 * Runtime falso en C:/tmp/guardian-test/mantenimiento-*: no toca Sentinel real. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutarMantenimiento, LIMITE_SALIDA } from './mantenimiento.js';
import { ErrorValidacion } from './politica.js';

const BASE_TMP = 'C:/tmp/guardian-test';
const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

/* FAKE_MODO elige la salida y el código; FAKE_ECO vuelca los argumentos recibidos. */
const RUNTIME_FALSO = `
const fs = require('node:fs');
const modo = process.env.FAKE_MODO;
if (process.env.FAKE_ECO) fs.writeFileSync(process.env.FAKE_ECO, JSON.stringify(process.argv.slice(2)));
if (modo === 'ok') {
  console.log('Runtime actualizado');
} else if (modo === 'largo') {
  process.stdout.write('x'.repeat(20000));
} else if (modo === 'fallo') {
  console.error('perfil con error');
  process.exitCode = 1;
} else if (modo === 'cuelga') {
  setInterval(() => {}, 1000);
} else if (modo === 'lento') {
  setTimeout(() => console.log('fin'), 600);
}
`;

function prepararRuntime(): { dir: string; runtime: string } {
  mkdirSync(BASE_TMP, { recursive: true });
  const dir = mkdtempSync(join(BASE_TMP, 'mantenimiento-'));
  temporales.push(dir);
  const runtime = join(dir, 'runtime.cjs');
  writeFileSync(runtime, RUNTIME_FALSO, 'utf8');
  return { dir, runtime };
}

function envFalso(modo: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, FAKE_MODO: modo, ...extra };
}

function argvDe(eco: string): string[] {
  return JSON.parse(readFileSync(eco, 'utf8')) as string[];
}

describe('ejecutarMantenimiento: simulación y aplicación', () => {
  it('sin confirmar es dry-run y no pasa flags de escritura', async () => {
    const { dir, runtime } = prepararRuntime();
    const eco = join(dir, 'eco.json');
    const r = await ejecutarMantenimiento({}, { runtimeJs: runtime, entorno: envFalso('ok', { FAKE_ECO: eco }) });
    assert.equal(r.estado, 'ok');
    assert.equal(r.modo, 'simulacion');
    assert.equal(r.codigo, 0);
    assert.match(r.salida, /Runtime actualizado/u);
    assert.deepEqual(argvDe(eco), ['update', '--dry-run']);
  });

  it('confirmar con shims y perfiles pasa los flags sin dry-run', async () => {
    const { dir, runtime } = prepararRuntime();
    const eco = join(dir, 'eco.json');
    const r = await ejecutarMantenimiento(
      { conShims: true, conPerfiles: true, confirmar: true },
      { runtimeJs: runtime, entorno: envFalso('ok', { FAKE_ECO: eco }) },
    );
    assert.equal(r.modo, 'aplicado');
    assert.equal(r.estado, 'ok');
    assert.deepEqual(argvDe(eco), ['update', '--with-shims', '--with-profiles']);
  });

  it('rutas de origen y destino van como argumentos separados, sin shell', async () => {
    const { dir, runtime } = prepararRuntime();
    const eco = join(dir, 'eco.json');
    const destino = join(dir, 'target');
    await ejecutarMantenimiento(
      { sourceRoot: 'C:/glory/sentinel', targetRoot: destino, confirmar: true },
      { runtimeJs: runtime, entorno: envFalso('ok', { FAKE_ECO: eco }) },
    );
    assert.deepEqual(argvDe(eco), ['update', '--source-root', 'C:/glory/sentinel', '--target-root', destino]);
  });

  it('exit distinto de 0 es error con código y salida de stderr', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await ejecutarMantenimiento({ confirmar: true }, { runtimeJs: runtime, entorno: envFalso('fallo') });
    assert.equal(r.estado, 'error');
    assert.equal(r.codigo, 1);
    assert.equal(r.motivo, 'Sentinel terminó con código 1');
    assert.match(r.salida, /perfil con error/u);
  });

  it('no termina a tiempo → error de tiempo agotado', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await ejecutarMantenimiento(
      { confirmar: true },
      { runtimeJs: runtime, entorno: envFalso('cuelga'), timeoutMs: 1500 },
    );
    assert.equal(r.estado, 'error');
    assert.equal(r.codigo, null);
    assert.match(r.motivo ?? '', /no terminó a tiempo/u);
    /* El bloqueo se libera al fallar: la llamada siguiente sí se ejecuta. */
    const siguiente = await ejecutarMantenimiento({}, { runtimeJs: runtime, entorno: envFalso('ok') });
    assert.equal(siguiente.estado, 'ok');
  });

  it('salida larga se recorta al límite', async () => {
    const { runtime } = prepararRuntime();
    const r = await ejecutarMantenimiento({}, { runtimeJs: runtime, entorno: envFalso('largo') });
    assert.equal(r.estado, 'ok');
    assert.ok(r.salida.length <= LIMITE_SALIDA + 40);
    assert.match(r.salida, /salida recortada/u);
  });

  it('dos llamadas simultáneas: la segunda no llega a ejecutar Sentinel', async () => {
    const { dir, runtime } = prepararRuntime();
    const eco = join(dir, 'eco.json');
    const [primera, segunda] = await Promise.all([
      ejecutarMantenimiento({ confirmar: true }, { runtimeJs: runtime, entorno: envFalso('lento', { FAKE_ECO: eco }) }),
      ejecutarMantenimiento({ confirmar: true }, { runtimeJs: runtime, entorno: envFalso('lento') }),
    ]);
    assert.equal(primera.estado, 'ok');
    assert.equal(segunda.estado, 'error');
    assert.equal(segunda.motivo, 'ya hay una actualización de Sentinel en curso');
  });
});

describe('ejecutarMantenimiento: validación de la entrada', () => {
  it('entrada inválida lanza ErrorValidacion sin ejecutar nada', async () => {
    const malas: Array<Record<string, unknown>> = [
      { sourceRoot: 'relativa/sentinel' },
      { targetRoot: 'C:/ok\0mal' },
      { conShims: 'si' },
      { conPerfiles: true },
      { confirmar: 'sí' },
    ];
    for (const entrada of malas) {
      await assert.rejects(
        ejecutarMantenimiento(entrada as never, { runtimeJs: 'C:/no-existe.cjs' }),
        ErrorValidacion,
        JSON.stringify(entrada),
      );
    }
  });
});
