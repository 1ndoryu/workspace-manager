/* Diagnostico del catalogo de reglas de sentinel.config.json.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/gate/esquema.test.ts
 * [por que] Un id del catalogo sin entrada usa su valor por defecto en el runtime;
 * no debe avisar como "falta una opcion recomendada" (105 avisos falsos en MN). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticar } from './esquema.js';
import { ESQUEMA_SENTINEL } from './sentinel.js';

const base = {
  schemaVersion: 2,
  mode: 'enforce',
  project: { primaryBranch: 'main' },
  runtime: { minimumVersion: '0.7.21', protocolVersion: 1, lockFile: 'sentinel.lock.json' },
  directoryExceptions: [],
  portableBoundaries: { dom: [], window: [], services: [], loggerModules: [] },
  analyzers: { sentinel: { enabled: true, profile: 'mixed', config: {} } },
};

describe('gate: catalogo de reglas (sentinel)', () => {
  it('rules vacio: los ids del catalogo sin entrada no son avisos recomendados', () => {
    const filas = diagnosticar(ESQUEMA_SENTINEL(), { ...base, rules: {} });
    const deReglas = filas.filter((f) => f.ruta[0] === 'rules' && f.ruta.length === 2 && 'necesidad' in f);
    assert.ok(deReglas.length > 0, 'el editor debe seguir enumerando las reglas');
    assert.ok(deReglas.every((f) => 'necesidad' in f && f.necesidad === 'opcional'));
  });

  it('rules ausente: sigue avisando como recomendada', () => {
    const filas = diagnosticar(ESQUEMA_SENTINEL(), base);
    const aviso = filas.find((f) => f.tipo === 'faltante' && f.ruta.join('/') === 'rules');
    assert.ok(aviso && 'necesidad' in aviso && aviso.necesidad === 'recomendada');
  });
});
