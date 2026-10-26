/* Tests de `motivoExes`: el exe de `boton` en una ficha remota pertenece al host y su
 * ausencia en el portátil no es deriva; en una ficha local sigue siendo aviso. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motivoExes } from '../ficha/validacion-fs.mjs';

// Ruta de Windows con letra de unidad: así el validador la trata como exe absoluto en cualquier SO.
const BOTON = [['C:\\tmp\\no-existe\\pulse.exe']];

test('motivoExes: exe ausente en ficha remota no es deriva del portátil', () => {
  assert.equal(motivoExes({ id: 'X', host: 'taller-remoto', boton: BOTON }, '.'), null);
});

test('motivoExes: exe ausente en ficha local sigue avisando', () => {
  assert.match(motivoExes({ id: 'X', boton: BOTON }, '.'), /exe inexistente/);
});
