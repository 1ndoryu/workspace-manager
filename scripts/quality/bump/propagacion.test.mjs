/* Pruebas de la forma del doctor que el propagador ejecuta. Corren en la VPS 89 (AGENTS §8). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pasosDe } from './release.mjs';

function consumidorCon(pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-doctor-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return { dir, nombre: 'fixture' };
}

test('doctor del script npm vive en el proyecto: puede correr en la 89', () => {
  const pasos = pasosDe(consumidorCon({ scripts: { 'quality:doctor': 'x' } }), {}, null);
  assert.deepEqual(pasos.doctor, { argv: ['npm', 'run', 'quality:doctor', '--silent'], enProyecto: true });
});

test('sin script de doctor ni CLI local no hay doctor', () => {
  assert.equal(pasosDe(consumidorCon({}), {}, null).doctor, null);
});
