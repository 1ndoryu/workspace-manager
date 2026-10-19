/* Pruebas de la forma del doctor que el propagador ejecuta. Corren en la VPS 89 (AGENTS §8). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pasosDe } from './release.mjs';
import { soloEntornoSinHerramienta } from './propagacion.mjs';

function consumidorCon(pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-doctor-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return { dir, nombre: 'fixture' };
}

test('doctor del script npm vive en el proyecto: puede correr en la 89', () => {
  const pasos = pasosDe(consumidorCon({ scripts: { 'quality:doctor': 'x' } }), {}, null);
  assert.deepEqual(pasos.doctor, { argv: ['npm', 'run', 'quality:doctor', '--silent'], enProyecto: true, remota: null });
});

test('con commit de sentinel, el doctor se remite a la CLI remota preparada por el setup', () => {
  const pasos = pasosDe(consumidorCon({ scripts: { 'quality:doctor': 'x' } }), {}, { commit: 'abc123' });
  assert.deepEqual(pasos.doctor.remota, { nombre: 'sentinel', commit: 'abc123' });
});

test('sin script de doctor ni CLI local no hay doctor', () => {
  assert.equal(pasosDe(consumidorCon({}), {}, null).doctor, null);
});

test('solo cuenta como entorno de 89 si todos los issues son de herramienta ausente', () => {
  const ausente = { code: 'tool-cli-missing' };
  assert.equal(soloEntornoSinHerramienta({ issues: [ausente, { code: 'tool-source-missing' }] }), true);
  assert.equal(soloEntornoSinHerramienta({ issues: [ausente, { code: 'pin-stale' }] }), false);
  assert.equal(soloEntornoSinHerramienta({ issues: [] }), false);
  assert.equal(soloEntornoSinHerramienta(null), false);
});
