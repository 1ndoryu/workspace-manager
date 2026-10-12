/* Puras de la salida de alta (10AA-2 F10). Se corre con:
 * node node_modules/tsx/dist/cli.mjs --test src/server/dev/alta.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarAlta } from './alta.js';

const salida = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    etiqueta: 'demo',
    hechos: 1,
    total: 2,
    items: [
      { nombre: 'stack', ok: true, detalle: 'node' },
      { nombre: 'sentinel', ok: false, detalle: 'sin sentinel.config.json', accion: 'configura Sentinel', bloque: 'x' },
    ],
    ...extra,
  });

describe('interpretarAlta', () => {
  it('lee el resumen y conserva accion solo donde existe', () => {
    const r = interpretarAlta(salida());
    assert.deepEqual(r, {
      etiqueta: 'demo',
      hechos: 1,
      total: 2,
      items: [
        { nombre: 'stack', ok: true, detalle: 'node' },
        { nombre: 'sentinel', ok: false, detalle: 'sin sentinel.config.json', accion: 'configura Sentinel' },
      ],
    });
  });

  it('salida vacía, rota o sin el formato esperado → null', () => {
    assert.equal(interpretarAlta(''), null);
    assert.equal(interpretarAlta('✓ stack — node'), null);
    assert.equal(interpretarAlta('null'), null);
    assert.equal(interpretarAlta(JSON.stringify({ etiqueta: 'x', hechos: 0, total: 0 })), null);
    assert.equal(interpretarAlta(salida({ hechos: '1' })), null);
  });

  it('un ítem mal formado invalida el resumen entero', () => {
    const sinNombre = JSON.stringify({ etiqueta: 'x', hechos: 0, total: 1, items: [{ ok: true, detalle: 'd' }] });
    assert.equal(interpretarAlta(sinNombre), null);
  });
});
