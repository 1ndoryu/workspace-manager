import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enTaller } from './remoto.js';

/* [por que] Regresion: un registro ilegible se tragaba y el audit corria en local,
 * contra AGENTS §1. El error debe llegar a quien llama para marcarlo como 'error'. */
test('enTaller: un error al leer el modo se propaga, no cae a local', () => {
  assert.throws(
    () => enTaller('proyecto', () => { throw new Error('registro ilegible'); }),
    /registro ilegible/,
  );
});

test('enTaller: solo el modo taller manda la auditoria a la 89', () => {
  assert.equal(enTaller('proyecto', () => 'taller'), true);
  assert.equal(enTaller('proyecto', () => 'local'), false);
});
