/* Diagnostico del esquema de varsense.config.json (tablero).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/gate/catalogo/varsense.test.ts
 * [por que] El tablero marcaba "clave desconocida" en MN-Inmobiliaria porque el
 * esquema no conocia tokenDetection.unused.excludeTokens, que varsense sí acepta. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticar } from '../modelo/esquema.js';
import { ESQUEMA_VARSENSE } from './varsense.js';

const desconocidas = (json: unknown) =>
  diagnosticar(ESQUEMA_VARSENSE(), json).filter((f) => f.tipo === 'desconocida').map((f) => f.ruta.join('.'));

describe('gate: esquema de varsense.config.json', () => {
  it('acepta tokenDetection.unused.excludeTokens y crossFile (claves que varsense admite)', () => {
    const json = {
      tokenDetection: {
        unused: { severity: 'hint', excludeTokens: ['--color-card-foreground'] },
        crossFile: { enabled: true },
      },
    };
    assert.deepEqual(desconocidas(json), []);
  });

  it('sigue marcando como desconocida una clave que varsense no admite', () => {
    const json = { tokenDetection: { unused: { typo: true } } };
    assert.deepEqual(desconocidas(json), ['tokenDetection.unused.typo']);
  });
});
