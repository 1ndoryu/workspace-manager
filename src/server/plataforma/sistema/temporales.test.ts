/* Test de la raíz de temporales por plataforma. Se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/plataforma/temporales.test.ts`. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { raizTemporales } from './temporales.js';

const CASA_LINUX = '/home/usuario';

describe('raizTemporales', () => {
  it('en Windows usa C:/tmp', () => {
    assert.equal(raizTemporales({}, 'win32', 'C:\\Users\\usuario'), 'C:/tmp');
  });

  it('en Linux usa ~/tmp, sin unidad C:', () => {
    assert.equal(raizTemporales({}, 'linux', CASA_LINUX), path.join(CASA_LINUX, 'tmp'));
  });

  it('WM_TMP gana a la plataforma; vacía o solo espacios cae al valor por defecto', () => {
    assert.equal(raizTemporales({ WM_TMP: 'D:/scratch' }, 'linux', CASA_LINUX), 'D:/scratch');
    assert.equal(raizTemporales({ WM_TMP: '  ' }, 'linux', CASA_LINUX), path.join(CASA_LINUX, 'tmp'));
    assert.equal(raizTemporales({ WM_TMP: '' }, 'win32', 'C:\\Users\\usuario'), 'C:/tmp');
  });
});
