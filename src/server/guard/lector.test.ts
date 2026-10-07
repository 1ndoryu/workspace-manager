/* Test del lector Guard (07AA-6 F6): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/guard/lector.test.ts`
 * (el repo no tiene runner TS; node --test solo entiende JS). Fixtures en tmp:
 * ningún test toca proyectos reales. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerGuardProyecto, leerOverride, leerPolitica, leerTareas } from './lector.js';

const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

function raizTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'guard-test-'));
  temporales.push(d);
  return d;
}

describe('leerPolitica', () => {
  it('ausente sin sentinel.config.json: defaults observe', () => {
    const p = leerPolitica(raizTmp());
    assert.equal(p.config, 'ausente');
    assert.equal(p.modo, 'observe');
    assert.deepEqual(p.limites, {});
  });
  it('ilegible con JSON roto', () => {
    const r = raizTmp();
    writeFileSync(join(r, 'sentinel.config.json'), '{no json', 'utf8');
    assert.equal(leerPolitica(r).config, 'ilegible');
  });
  it('ok sin clave budgets: defaults observe', () => {
    const r = raizTmp();
    writeFileSync(join(r, 'sentinel.config.json'), '{"schemaVersion":2}', 'utf8');
    const p = leerPolitica(r);
    assert.equal(p.config, 'ok');
    assert.equal(p.modo, 'observe');
  });
  it('enforce + limits numéricos; ignora no-numéricos; lista claves extra', () => {
    const r = raizTmp();
    writeFileSync(
      join(r, 'sentinel.config.json'),
      JSON.stringify({ budgets: { mode: 'enforce', limits: { 'cargo-check': 2, 'mi-clase': 3, roto: 'x' } } }),
      'utf8',
    );
    const p = leerPolitica(r);
    assert.equal(p.modo, 'enforce');
    assert.deepEqual(p.limites, { 'cargo-check': 2, 'mi-clase': 3 });
    assert.deepEqual(p.limitesExtra, ['mi-clase']);
  });
  it('modo desconocido cae a observe como Sentinel', () => {
    const r = raizTmp();
    writeFileSync(join(r, 'sentinel.config.json'), '{"budgets":{"mode":"r strict"}}', 'utf8');
    assert.equal(leerPolitica(r).modo, 'observe');
  });
});

describe('leerOverride', () => {
  it('ausente: extra 0', () => {
    assert.deepEqual(leerOverride(raizTmp()), { existe: false, extra: 0, primeraLinea: '' });
  });
  it('lee el primer entero con +', () => {
    const r = raizTmp();
    writeFileSync(join(r, 'lote-extra.md'), '+3 espiral fmt (2026-10-07)\n', 'utf8');
    const o = leerOverride(r);
    assert.equal(o.existe, true);
    assert.equal(o.extra, 3);
  });
});

describe('leerTareas', () => {
  it('agrega started/blocked, ignora corruptas y otras clases', () => {
    const r = raizTmp();
    const dir = join(r, '.quality-reports', 'check', '07AA-99');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'runs.jsonl'),
      [
        '{"ts":"2026-10-07T10:00:00Z","kind":"cargo-check","stage":"clippy","status":"started","used":1,"limit":2,"extra":0,"mode":"enforce"}',
        '{"ts":"2026-10-07T10:05:00Z","kind":"cargo-check","stage":"clippy","status":"blocked","used":2,"limit":2,"extra":0,"mode":"enforce"}',
        'linea corrupta',
        '{"kind":"fmt","status":"started"}',
        '{"kind":"","status":"started"}',
      ].join('\n'),
      'utf8',
    );
    const tareas = leerTareas(r);
    assert.equal(tareas.length, 1);
    const cc = tareas[0].clases['cargo-check'];
    assert.equal(cc.iniciados, 1);
    assert.equal(cc.bloqueados, 1);
    assert.equal(cc.limite, 2);
    assert.equal(cc.modo, 'enforce');
    assert.equal(tareas[0].totalBloqueados, 1);
    /* fmt (clase no pesada) también se agrega: el lector muestra lo que
     * haya en el diario, no filtra por lista cerrada. */
    assert.equal(tareas[0].clases['fmt'].iniciados, 1);
  });
  it('sin .quality-reports: vacío', () => {
    assert.deepEqual(leerTareas(raizTmp()), []);
  });
});

describe('leerGuardProyecto', () => {
  it('suma totalBloqueados de todas las tareas', () => {
    const r = raizTmp();
    for (const t of ['07AA-10', '07AA-11']) {
      const dir = join(r, '.quality-reports', 'check', t);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'runs.jsonl'),
        `{"ts":"2026-10-07T10:00:00Z","kind":"cargo-check","status":"blocked","used":2,"limit":2}\n`,
        'utf8',
      );
    }
    const e = leerGuardProyecto('demo', r);
    assert.equal(e.tareas.length, 2);
    assert.equal(e.totalBloqueados, 2);
    assert.equal(e.clave, 'demo');
  });
});
