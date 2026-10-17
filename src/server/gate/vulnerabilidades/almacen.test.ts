/* Regla de qué entra en la caché de vulnerabilidades.
 * Se corre con: node --import tsx --test src/server/gate/vulnerabilidades/almacen.test.ts
 * [por que] Solo se prueba la parte pura (`esCacheable`): el resto escribe en
 * `data/cache/vulnerabilidades.json`, que es el fichero real del área, y un test
 * no debe meter datos falsos ahí. Lo que se fija es la decisión —qué estados se
 * guardan—, que es la que evita perder el conteo al reiniciar. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esCacheable } from './almacen.js';
import type { AnalisisVulnerabilidades } from '../../../shared/types.js';

const dato = (estado: AnalisisVulnerabilidades['estado']): AnalisisVulnerabilidades =>
  ({ clave: 'x', gestor: 'cargo', lockfile: 'Cargo.lock', estado, hallazgos: [], resumen: {} }) as unknown as AnalisisVulnerabilidades;

describe('gate: caché de vulnerabilidades', () => {
  it('guarda una medición real', () => {
    assert.equal(esCacheable(dato('conHallazgos')), true);
    assert.equal(esCacheable(dato('ok')), true);
  });

  it('guarda noAuditable: es un hecho estable del proyecto, y re-detectarlo en cada arranque es trabajo repetido', () => {
    assert.equal(esCacheable(dato('noAuditable')), true);
  });

  it('NO guarda error: es transitorio y servirlo dejaba el conteo en cero sin avisar', () => {
    assert.equal(esCacheable(dato('error')), false);
  });
});
