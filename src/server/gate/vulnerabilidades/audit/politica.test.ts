import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLITICA_GESTOR } from './politica.js';

/* [por que] Fija qué gestor filtra por alcance y cuál cuenta su ausencia como noAuditable:
 * si alguien añade un gestor sin decidir esto, el test de la tabla completa lo avisa. */
test('solo cargo filtra por alcance y su ausencia es noAuditable', () => {
  assert.deepEqual(POLITICA_GESTOR.cargo, { filtraAlcance: true, ausenciaEsNoAuditable: true });
  assert.equal(POLITICA_GESTOR.npm.filtraAlcance, false);
  assert.equal(POLITICA_GESTOR.pnpm.filtraAlcance, false);
  assert.equal(POLITICA_GESTOR.npm.ausenciaEsNoAuditable, false);
  assert.equal(POLITICA_GESTOR.pnpm.ausenciaEsNoAuditable, false);
});
