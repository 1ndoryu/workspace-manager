/* Tests del mando gate/comandos (10AA-2 F9.4-F9.5): parsers puros, sin backend. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parsearArgsGate, rutaSnapshot, leerComandos, formatearNuevos, RAIZ } from './gate.mjs';

test('parsearArgsGate exige id y exactamente un modo', () => {
  assert.deepEqual(parsearArgsGate(['glory-pulse', '--inicio']), { id: 'glory-pulse', modo: 'inicio' });
  assert.deepEqual(parsearArgsGate(['glory-pulse', '--cierre']), { id: 'glory-pulse', modo: 'cierre' });
  assert.ok(parsearArgsGate([]).error);
  assert.ok(parsearArgsGate(['--inicio']).error);
  assert.ok(parsearArgsGate(['x']).error);
  assert.ok(parsearArgsGate(['x', '--inicio', '--cierre']).error);
  assert.ok(parsearArgsGate(['x', '--inicio', '--raro']).error);
});

test('rutaSnapshot usa data/gate-inicio y admite espacios en la clave', () => {
  assert.equal(rutaSnapshot('PROYECTO TASKS', RAIZ), join(RAIZ, 'data', 'gate-inicio', 'PROYECTO TASKS.json'));
});

test('leerComandos acepta el contrato completo y null donde no aplica', () => {
  const r = leerComandos({ gate: 'node x.mjs gate', 'test-archivo': null, typecheck: 'npm run type-check', build: null });
  assert.equal(r.error, undefined);
  assert.equal(r.comandos.typecheck, 'npm run type-check');
});

test('leerComandos rechaza ausencia, claves desconocidas y textos vacíos', () => {
  assert.match(leerComandos(undefined).error, /sin contrato/);
  assert.match(leerComandos(['gate']).error, /debe ser un objeto/);
  assert.match(leerComandos({ lint: 'x' }).error, /clave desconocida 'lint'/);
  assert.match(leerComandos({ gate: '   ' }).error, /texto no vacío/);
  assert.match(leerComandos({ gate: 3 }).error, /texto no vacío/);
});

test('formatearNuevos imprime archivo:línea, regla y mensaje', () => {
  const lineas = formatearNuevos([{ archivo: 'src/a.ts', linea: 7, ruleId: 'regla-x', mensaje: 'algo' }]);
  assert.deepEqual(lineas, ['  src/a.ts:7  regla-x  algo']);
  assert.deepEqual(formatearNuevos([{ archivo: 'b.ts', ruleId: 'r', mensaje: 'm' }]), ['  b.ts:?  r  m']);
});
