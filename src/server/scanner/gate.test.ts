/* Estilos del gate: sin hojas de estilo, varsense no se marca "ausente".
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/scanner/gate.test.ts
 * [por que] Los temporales van bajo C:/tmp (AGENTS.md §0.2), nunca en %TEMP% ni en el repo. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estadoGate, hayEstilos } from './gate.js';

describe('gate: sinEstilos', () => {
  let raiz: string;

  before(() => {
    mkdirSync('C:/tmp', { recursive: true });
    raiz = mkdtempSync('C:/tmp/gate-test-');
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('proyecto con sentinel y sin CSS: no hay estilos', () => {
    const p = mkdtempSync(join(raiz, 'sin-css-'));
    writeFileSync(join(p, 'sentinel.config.json'), '{}');
    writeFileSync(join(p, 'index.js'), '');
    assert.equal(hayEstilos(p), false);
    const g = estadoGate(p);
    assert.equal(g.declarado, true);
    assert.equal(g.sinEstilos, true);
  });

  it('CSS anidado encuentra estilos y no marca sinEstilos', () => {
    const p = mkdtempSync(join(raiz, 'con-css-'));
    writeFileSync(join(p, 'sentinel.config.json'), '{}');
    mkdirSync(join(p, 'src', 'ui'), { recursive: true });
    writeFileSync(join(p, 'src', 'ui', 'tema.scss'), '');
    assert.equal(hayEstilos(p), true);
    assert.equal(estadoGate(p).sinEstilos, false);
  });

  it('ignora CSS dentro de node_modules y ocultos', () => {
    const p = mkdtempSync(join(raiz, 'ignorados-'));
    mkdirSync(join(p, 'node_modules', 'lib'), { recursive: true });
    mkdirSync(join(p, '.cache'), { recursive: true });
    writeFileSync(join(p, 'node_modules', 'lib', 'a.css'), '');
    writeFileSync(join(p, '.cache', 'b.css'), '');
    assert.equal(hayEstilos(p), false);
  });

  it('tailwind.config cuenta como estilos', () => {
    const p = mkdtempSync(join(raiz, 'tailwind-'));
    writeFileSync(join(p, 'tailwind.config.ts'), '');
    assert.equal(hayEstilos(p), true);
  });

  it('con varsense.config.json no se calcula sinEstilos', () => {
    const p = mkdtempSync(join(raiz, 'con-varsense-'));
    writeFileSync(join(p, 'sentinel.config.json'), '{}');
    writeFileSync(join(p, 'varsense.config.json'), '{}');
    const g = estadoGate(p);
    assert.equal(g.varsense, true);
    assert.equal(g.sinEstilos, false);
  });
});
