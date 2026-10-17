/* Dónde corre el doctor: mismo reparto que el análisis (taller si el modo lo pide,
 * portátil como red). Se corre con:
 *   node node_modules/tsx/dist/cli.mjs --test src/server/gate/doctor.test.ts
 * [por que] Los temporales van bajo C:/tmp (AGENTS.md §0.2), nunca en %TEMP__ ni en el repo. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { doctorConModo } from './doctor.js';

/* Runtime falso con la misma forma que el real: `quality-tools.json` declara su
 * `provisionPath` y el CLI imprime un JSON y sale con 1 (como el doctor de verdad
 * cuando hay issues). */
function proyectoConDoctorFalso(raiz: string, salida: string): string {
  const p = mkdtempSync(join(raiz, 'proyecto-'));
  const runtime = join(p, 'runtime');
  mkdirSync(join(runtime, 'out', 'cli'), { recursive: true });
  writeFileSync(join(runtime, 'package.json'), '{"version":"9.9.9"}');
  writeFileSync(join(runtime, 'out', 'cli', 'index.js'),
    `process.stdout.write(${JSON.stringify(salida)});\nprocess.exitCode = 1;\n`);
  writeFileSync(join(p, 'quality-tools.json'),
    JSON.stringify({ tools: { sentinel: { provisionPath: './runtime', cli: 'out/cli/index.js' } } }));
  return p;
}

describe('doctor: modo local', () => {
  let raiz: string;

  before(() => {
    mkdirSync('C:/tmp', { recursive: true });
    raiz = mkdtempSync('C:/tmp/doctor-test-');
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  /* [por que] El doctor sale con 1 cuando hay issues y su JSON sigue siendo el
   * diagnóstico: antes se descartaba y el tablero mostraba "sin salida". */
  it('usa el CLI del manifest y devuelve su diagnóstico aunque salga con 1', async () => {
    const p = proyectoConDoctorFalso(raiz, JSON.stringify({ policy: { status: 'policy' } }));
    const r = await doctorConModo('clave-de-prueba', p, { modo: 'local' });
    assert.equal(r.modo, 'local');
    assert.equal(r.aviso, undefined);
    assert.ok(r.salida?.includes('"status":"policy"'), `salida: ${r.salida}`);
  });

});

describe('doctor: el portátil como red', () => {
  let raiz: string;

  before(() => {
    mkdirSync('C:/tmp', { recursive: true });
    raiz = mkdtempSync('C:/tmp/doctor-red-');
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  /* [por que] Frente 5: la VPS no es un requisito duro. Si el doctor remoto no arranca
   * (aquí se simula con un runner que falla), el resultado sale del portátil y `aviso`
   * dice por qué. Sin ese aviso la degradación sería silenciosa, que es justo lo que no
   * queremos. El testigo es que el diagnóstico local SÍ aparece. */
  it('si el taller no responde, corre en local y lo dice', async () => {
    const p = proyectoConDoctorFalso(raiz, JSON.stringify({ policy: { status: 'red' } }));
    const r = await doctorConModo('clave-de-prueba', p, {
      modo: 'taller',
      remoto: async () => { throw new Error('sin sesión Mutagen'); },
    });
    assert.equal(r.modo, 'local');
    assert.equal(r.aviso, 'hecho en local, el taller no respondió (sin sesión Mutagen)');
    assert.ok(r.salida?.includes('"status":"red"'), `salida: ${r.salida}`);
  });

  /* [por que] Cuando el taller contesta, el diagnóstico es suyo y el portátil no se
   * toca: `modo` lo declara y no hay `aviso`. */
  it('si el taller contesta, el diagnóstico es del taller', async () => {
    const p = proyectoConDoctorFalso(raiz, 'no debería usarse');
    const r = await doctorConModo('clave-de-prueba', p, {
      modo: 'taller',
      remoto: async () => '{"desde":"la 89"}',
    });
    assert.deepEqual(r, { salida: '{"desde":"la 89"}', modo: 'taller' });
  });
});
