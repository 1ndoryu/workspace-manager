/* Pruebas de la lectura única del estado de un servicio (`shared/vps/salud.ts`). Es la regla que
 * comparten el panel, la campana y el aviso del sistema: si se desvía, el tablero se contradice. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESTADO_CAIDO, estaVivo, peorSalud, saludDeEstado } from './salud.js';

test('estados vivos', () => {
  for (const e of ['running', 'running:healthy', 'Running', 'restarting', 'restarting:unhealthy']) {
    assert.equal(saludDeEstado(e), 'vivo', e);
  }
});

test('degradado sirve pero se distingue', () => {
  assert.equal(saludDeEstado('degraded'), 'degradado');
  assert.equal(saludDeEstado('degraded:unhealthy'), 'degradado');
  assert.equal(estaVivo('degraded:unhealthy'), true);
});

test('caído: apagado, detenido, exited y lo que no reconozco', () => {
  for (const e of ['exited', 'exited:0', 'apagado', 'detenido', 'stopped', 'paused', 'created']) {
    assert.equal(saludDeEstado(e), 'caido', e);
    assert.equal(estaVivo(e), false, e);
  }
});

test('ESTADO_CAIDO se lee como caído: el panel del taller y la campana dicen lo mismo', () => {
  assert.equal(saludDeEstado(ESTADO_CAIDO), 'caido');
  assert.equal(estaVivo(ESTADO_CAIDO), false);
});

test('sin dato es desconocido, nunca caído', () => {
  for (const e of ['', null, undefined, 'desconocido', 'sin-asignar', 'sin-estado-real']) {
    assert.equal(saludDeEstado(e), 'desconocido', String(e));
    assert.equal(estaVivo(e), false);
  }
});

test('peorSalud manda el peor, y vacío es desconocido', () => {
  assert.equal(peorSalud([]), 'desconocido');
  assert.equal(peorSalud(['desconocido', 'desconocido']), 'desconocido');
  assert.equal(peorSalud(['running', 'degraded']), 'degradado');
  assert.equal(peorSalud(['degraded', 'exited']), 'caido');
  assert.equal(peorSalud(['running', 'running:healthy']), 'vivo');
  assert.equal(peorSalud(['running', 'desconocido']), 'vivo', 'un contenedor sin dato no hunde el sitio');
});
