/* [08AA-26] Traduccion del reporte y politica de cache: nada de esto lanza el
 * CLI, asi que se prueba sin runtime de Sentinel.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/gate/analisis/reporte.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esCacheable } from './almacen.js';
import { marcarVarsenseFallido, normalizar } from './reporte.js';

type Dato = Parameters<typeof esCacheable>[0];
type Reporte = Parameters<typeof normalizar>[0];

describe('reporte: linea de hallazgo en numeracion humana', () => {
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

describe('almacen: solo se cachea un analisis valido', () => {
  it('estado error no se cachea (fallo transitorio)', () => {
    assert.equal(esCacheable({ estado: 'error' } as Dato), false);
  });

  it('ok y conHallazgos si se cachean', () => {
    assert.equal(esCacheable({ estado: 'ok' } as Dato), true);
    assert.equal(esCacheable({ estado: 'conHallazgos' } as Dato), true);
  });
});

describe('reporte: varsense declarado sin reporte no es ok', () => {
  it('pasa a error, conserva el error previo y no se cachea', () => {
    const sinVs = marcarVarsenseFallido({ estado: 'ok', resumen: { error: 0, warning: 0, information: 0, hint: 0 }, hallazgos: [] } as unknown as Dato);
    assert.equal(sinVs.estado, 'error');
    assert.match(String(sinVs.error), /varsense declarado/);
    assert.equal(esCacheable(sinVs), false);
    const conErrorPrevio = marcarVarsenseFallido({ estado: 'error', error: 'runtime sentinel no disponible' } as unknown as Dato);
    assert.equal(conErrorPrevio.error, 'runtime sentinel no disponible');
  });
});
