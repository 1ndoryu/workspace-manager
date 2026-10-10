/* [08AA-26] Un analisis con estado error no entra en la cache del tablero.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/gate/analizador.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esCacheable, normalizar } from './analizador.js';

type Dato = Parameters<typeof esCacheable>[0];
type Reporte = Parameters<typeof normalizar>[0];

describe('analizador: linea de hallazgo en numeracion humana', () => {
  it('range.start.line 0-based de sentinel se muestra como linea real (+1)', () => {
    const dato = {
      severityCounts: { warning: 1 },
      entries: [{
        ruta: '/raiz/src/a.rs',
        findings: [{ ruleId: 'sqlx', message: 'm', severity: 'warning', range: { start: { line: 99 } } }],
      }],
    } as unknown as Reporte;
    const r = normalizar(dato, 'clave', '0.7.21', '/raiz');
    assert.equal(r.hallazgos[0].linea, 100);
  });
});

describe('analizador: solo se cachea un analisis valido', () => {
  it('estado error no se cachea (fallo transitorio)', () => {
    assert.equal(esCacheable({ estado: 'error' } as Dato), false);
  });

  it('ok y conHallazgos si se cachean', () => {
    assert.equal(esCacheable({ estado: 'ok' } as Dato), true);
    assert.equal(esCacheable({ estado: 'conHallazgos' } as Dato), true);
  });
});
