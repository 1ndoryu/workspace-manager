/* Pruebas de la construcción de comandos remotos: una clave de entorno mal formada no
 * puede colar órdenes en la línea que ejecuta la VPS. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asignacionesEntorno, comandoAnalisis } from './comandos.js';

test('asignacionesEntorno acepta nombres POSIX y entrecomilla el valor', () => {
  assert.deepEqual(asignacionesEntorno({ GLORY_SENTINEL_SOURCE_PATH: "/a b's" }), [
    "GLORY_SENTINEL_SOURCE_PATH='/a b'\\''s'",
  ]);
});

test('asignacionesEntorno rechaza una clave con separadores de orden', () => {
  assert.throws(() => asignacionesEntorno({ 'A=1; rm -rf ~ #': 'x' }), /no válido/);
  assert.throws(() => asignacionesEntorno({ 'A B': 'x' }), /no válido/);
});

test('comandoAnalisis no emite claves sin validar', () => {
  assert.throws(
    () => comandoAnalisis({ env: { 'X;id': '1' }, node: 'node', cli: '/c.js', verbo: 'analyze', workspace: '/w' }),
    /no válido/,
  );
});
