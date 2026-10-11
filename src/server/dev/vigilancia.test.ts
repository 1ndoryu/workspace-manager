/* Puras del fallo del doctor (vigilancia F0b). Se corre con:
 * node node_modules/tsx/dist/cli.mjs --test src/server/dev/vigilancia.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describirFalloDoctor } from './vigilancia.js';

describe('describirFalloDoctor', () => {
  it('distingue el timeout con su límite en ms', () => {
    assert.equal(describirFalloDoctor({ killed: true }, 60_000), 'timeout 60000 ms');
  });

  it('el timeout gana sobre un código de salida', () => {
    assert.equal(describirFalloDoctor({ killed: true, code: 1 }, 60_000), 'timeout 60000 ms');
  });

  it('informa el código de salida si no hubo timeout', () => {
    assert.equal(describirFalloDoctor({ killed: false, code: 1 }, 60_000), 'salida 1');
  });

  it('sin código ni timeout devuelve salida ?', () => {
    assert.equal(describirFalloDoctor({}, 60_000), 'salida ?');
  });
});
