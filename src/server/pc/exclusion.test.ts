/* Exclusión mutua scan ↔ limpieza: cada bandera es independiente y se apaga sola.
 * [por que] El módulo es hoja y sus predicados solo leen estas banderas; si alguien
 * vuelve a mezclarlas con el estado de scan o de limpieza, este test lo nota. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hayLimpiezaEnCurso, hayScanEnCurso, marcarLimpieza, marcarScan } from './exclusion.js';

test('las banderas arrancan apagadas y cada una es independiente', () => {
  marcarScan(false);
  marcarLimpieza(false);
  assert.equal(hayScanEnCurso(), false);
  assert.equal(hayLimpiezaEnCurso(), false);

  marcarScan(true);
  assert.equal(hayScanEnCurso(), true);
  assert.equal(hayLimpiezaEnCurso(), false);

  marcarScan(false);
  marcarLimpieza(true);
  assert.equal(hayScanEnCurso(), false);
  assert.equal(hayLimpiezaEnCurso(), true);

  marcarLimpieza(false);
  assert.equal(hayLimpiezaEnCurso(), false);
});
