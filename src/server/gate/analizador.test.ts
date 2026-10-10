/* [08AA-26] Un analisis con estado error no entra en la cache del tablero.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/gate/analizador.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esCacheable } from './analizador.js';

type Dato = Parameters<typeof esCacheable>[0];

describe('analizador: solo se cachea un analisis valido', () => {
  it('estado error no se cachea (fallo transitorio)', () => {
    assert.equal(esCacheable({ estado: 'error' } as Dato), false);
  });

  it('ok y conHallazgos si se cachean', () => {
    assert.equal(esCacheable({ estado: 'ok' } as Dato), true);
    assert.equal(esCacheable({ estado: 'conHallazgos' } as Dato), true);
  });
});
