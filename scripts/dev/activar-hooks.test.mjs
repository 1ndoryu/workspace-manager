/* Tests de la activación de hooks (19AA-12): sin git no hace nada, con git fija core.hooksPath. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activarHooks } from './activar-hooks.mjs';

test('activarHooks: sin .git no llama a git y sale sin error', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'wm-hooks-'));
  let llamadas = 0;
  assert.equal(activarHooks(raiz, () => { llamadas++; return { status: 0 }; }), 'sin-git');
  assert.equal(llamadas, 0);
});

test('activarHooks: con .git (carpeta o fichero) fija core.hooksPath', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'wm-hooks-'));
  mkdirSync(join(carpeta, '.git'));
  const args = [];
  assert.equal(activarHooks(carpeta, (a) => { args.push(a); return { status: 0 }; }), 'activado');
  assert.deepEqual(args[0], ['config', 'core.hooksPath', '.githooks']);

  const submodulo = mkdtempSync(join(tmpdir(), 'wm-hooks-'));
  writeFileSync(join(submodulo, '.git'), 'gitdir: ../x');
  assert.equal(activarHooks(submodulo, () => ({ status: 0 })), 'activado');
});

test('activarHooks: si git falla, lo dice', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'wm-hooks-'));
  mkdirSync(join(carpeta, '.git'));
  assert.equal(activarHooks(carpeta, () => ({ status: 1 })), 'error');
});
