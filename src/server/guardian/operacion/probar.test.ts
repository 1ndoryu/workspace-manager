/* Test del probe del Guardián (10AA-2 F11.4, «Probar»). Se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/guardian/probar.test.ts`.
 * Usa un runtime falso en C:/tmp/guardian-test/probar-* que imita la salida de
 * `current.js guard --json`: ni toca Sentinel real ni escribe en el diario. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { probarComando, runtimeJsPorDefecto, DIARIO_PRUEBAS } from './probar.js';
import { ErrorValidacion } from '../configuracion/politica.js';

const BASE_TMP = 'C:/tmp/guardian-test';
const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

/* Runtime falso: FAKE_MODO elige la salida y el código; FAKE_ECO vuelca argv y
 * variables relevantes a un fichero para comprobarlas. Sin process.exit: así el
 * stdout se vacía antes de salir. */
const RUNTIME_FALSO = `
const fs = require('node:fs');
const modo = process.env.FAKE_MODO;
if (process.env.FAKE_ECO) {
  fs.writeFileSync(process.env.FAKE_ECO, JSON.stringify({
    argv: process.argv.slice(2),
    logDir: process.env.GLORY_GUARD_LOG_DIR ?? null,
    lease: process.env.GLORY_QUALITY_GATE_LEASE ?? null,
    token: process.env.GLORY_QUALITY_GATE_TOKEN ?? null,
  }));
}
const base = { blocked: false, mode: 'enforce', action: 'pass', reason: null, category: null, policyStatus: 'ok', extra: 'no debe llegar' };
if (modo === 'pasa') {
  console.log(JSON.stringify(base));
} else if (modo === 'bloquea') {
  console.log(JSON.stringify({ ...base, blocked: true, action: 'block', reason: 'budget-exhausted', category: 'cargo-check', exitCode: 78, alternativa: 'amplía lote-extra.md' }));
  process.exitCode = 78;
} else if (modo === 'desacuerdo-0') {
  console.log(JSON.stringify({ ...base, blocked: true }));
} else if (modo === 'desacuerdo-78') {
  console.log(JSON.stringify(base));
  process.exitCode = 78;
} else if (modo === 'basura') {
  console.log('no es json');
} else if (modo === 'cuelga') {
  setInterval(() => {}, 1000);
} else if (modo === 'fallo') {
  process.exitCode = 2;
}
`;

function prepararRuntime(): { dir: string; runtime: string } {
  mkdirSync(BASE_TMP, { recursive: true });
  const dir = mkdtempSync(join(BASE_TMP, 'probar-'));
  temporales.push(dir);
  const runtime = join(dir, 'runtime.cjs');
  writeFileSync(runtime, RUNTIME_FALSO, 'utf8');
  return { dir, runtime };
}

function envFalso(modo: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, FAKE_MODO: modo, ...extra };
}

describe('probarComando: decisiones', () => {
  it('pasa: ok con blocked:false y solo los campos conocidos', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['run', 'lint'] },
      { runtimeJs: runtime, diarioDir: join(dir, 'diario'), entorno: envFalso('pasa') },
    );
    assert.deepEqual(r, {
      estado: 'ok',
      codigo: 0,
      decision: { blocked: false, mode: 'enforce', action: 'pass', category: null, policyStatus: 'ok' },
    });
  });

  it('bloquea: exit 78 es un resultado válido, no un error', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await probarComando(
      { raiz: dir, ejecutable: 'cargo', args: ['clippy'] },
      { runtimeJs: runtime, diarioDir: join(dir, 'diario'), entorno: envFalso('bloquea') },
    );
    assert.equal(r.estado, 'ok');
    if (r.estado !== 'ok') return;
    assert.equal(r.codigo, 78);
    assert.equal(r.decision.blocked, true);
    assert.equal(r.decision.reason, 'budget-exhausted');
    assert.equal(r.decision.category, 'cargo-check');
    assert.equal(r.decision.alternativa, 'amplía lote-extra.md');
  });

  it('exit 0 con blocked:true es desacuerdo → error', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['test'] },
      { runtimeJs: runtime, diarioDir: join(dir, 'diario'), entorno: envFalso('desacuerdo-0') },
    );
    assert.deepEqual(r, { estado: 'error', motivo: 'el código de salida y la decisión no coinciden' });
  });

  it('exit 78 con blocked:false es desacuerdo → error', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['test'] },
      { runtimeJs: runtime, diarioDir: join(dir, 'diario'), entorno: envFalso('desacuerdo-78') },
    );
    assert.equal(r.estado, 'error');
    if (r.estado === 'error') assert.match(r.motivo, /no coinciden/u);
  });

  it('salida que no es JSON → error', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['test'] },
      { runtimeJs: runtime, diarioDir: join(dir, 'diario'), entorno: envFalso('basura') },
    );
    assert.deepEqual(r, { estado: 'error', motivo: 'la salida de Sentinel no es JSON' });
  });

  it('código de salida ajeno a 78 → error con el código', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['test'] },
      { runtimeJs: runtime, diarioDir: join(dir, 'diario'), entorno: envFalso('fallo') },
    );
    assert.deepEqual(r, { estado: 'error', motivo: 'Sentinel terminó con código 2' });
  });

  it('runtime inexistente → error sin lanzar', async () => {
    const { dir } = prepararRuntime();
    const r = await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['test'] },
      { runtimeJs: join(dir, 'no-existe.cjs'), diarioDir: join(dir, 'diario'), entorno: envFalso('pasa') },
    );
    assert.equal(r.estado, 'error');
  });

  it('Sentinel que no responde a tiempo → error de tiempo agotado', async () => {
    const { dir, runtime } = prepararRuntime();
    const r = await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['test'] },
      { runtimeJs: runtime, diarioDir: join(dir, 'diario'), entorno: envFalso('cuelga'), timeoutMs: 1500 },
    );
    assert.deepEqual(r, { estado: 'error', motivo: 'Sentinel no respondió a tiempo' });
  });
});

describe('probarComando: entrada y entorno', () => {
  it('entrada inválida lanza ErrorValidacion sin ejecutar nada', async () => {
    const { dir } = prepararRuntime();
    const base = { raiz: dir, ejecutable: 'npm', args: ['test'] };
    const malas = [
      { ...base, raiz: 'relativa/proyecto' },
      { ...base, ejecutable: 'npm;rm' },
      { ...base, ejecutable: '' },
      { ...base, args: Array.from({ length: 65 }, () => 'x') },
      { ...base, args: ['a\0b'] },
      { ...base, args: ['x'.repeat(513)] },
    ];
    for (const entrada of malas) {
      await assert.rejects(
        probarComando(entrada, { runtimeJs: join(dir, 'no-existe.cjs') }),
        ErrorValidacion,
        JSON.stringify({ ejecutable: entrada.ejecutable, raiz: entrada.raiz }),
      );
    }
  });

  it('argumentos tras -- y sin variables de lease ni token; diario aislado', async () => {
    const { dir, runtime } = prepararRuntime();
    const eco = join(dir, 'eco.json');
    const diario = join(dir, 'diario');
    await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['run', '--', '--force'] },
      {
        runtimeJs: runtime,
        diarioDir: diario,
        entorno: envFalso('pasa', {
          FAKE_ECO: eco,
          GLORY_QUALITY_GATE_LEASE: 'lease-x',
          GLORY_QUALITY_GATE_TOKEN: 'token-x',
        }),
      },
    );
    const datos = JSON.parse(readFileSync(eco, 'utf8')) as {
      argv: string[];
      logDir: string | null;
      lease: string | null;
      token: string | null;
    };
    assert.deepEqual(datos.argv, [
      'guard',
      '--json',
      '--executable',
      'npm',
      '--project-root',
      dir,
      '--',
      'run',
      '--',
      '--force',
    ]);
    assert.equal(datos.logDir, diario);
    assert.equal(datos.lease, null);
    assert.equal(datos.token, null);
  });

  it('sin diarioDir el log va al directorio de pruebas', async () => {
    const { dir, runtime } = prepararRuntime();
    const eco = join(dir, 'eco.json');
    await probarComando(
      { raiz: dir, ejecutable: 'npm', args: ['test'] },
      { runtimeJs: runtime, entorno: envFalso('pasa', { FAKE_ECO: eco }) },
    );
    const datos = JSON.parse(readFileSync(eco, 'utf8')) as { logDir: string | null };
    assert.equal(datos.logDir, DIARIO_PRUEBAS);
  });

  it('el runtime por defecto es current.js de GlorySentinel', () => {
    assert.match(runtimeJsPorDefecto(), /GlorySentinel[\\/]current\.js$/u);
  });
});
