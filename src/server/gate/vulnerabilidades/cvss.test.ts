import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bandaCvss,
  bandaDeclarada,
  puntuacionCvss,
  severidadDeAviso,
  severidadDeVector,
} from './cvss.js';

/* Vectores con puntuacion publicada, que es la unica forma de probar una
 * formula implementada: si el calculo se desvia, el numero no coincide. */
test('puntuacionCvss: vectores de referencia de la especificacion 3.1', () => {
  const casos: Array<[string, number]> = [
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10.0],
    ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 7.8],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H', 7.5],
    ['CVSS:3.1/AV:L/AC:L/PR:H/UI:N/S:U/C:L/I:N/A:N', 2.3],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:N/A:N', 0],
  ];
  for (const [vector, esperado] of casos) {
    assert.equal(puntuacionCvss(vector), esperado, `vector ${vector}`);
  }
});

test('puntuacionCvss: los avisos reales de juego-arcade puntuan como dice su vector', () => {
  assert.equal(puntuacionCvss('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H'), 9.1);
  assert.equal(puntuacionCvss('CVSS:3.1/AV:L/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:H'), 7.3);
  assert.equal(puntuacionCvss('CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:H/I:N/A:N'), 4.0);
  assert.equal(puntuacionCvss('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N'), 3.7);
});

test('puntuacionCvss: un vector incompleto o ajeno no se adivina', () => {
  assert.equal(puntuacionCvss('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H'), null, 'falta A');
  assert.equal(puntuacionCvss('CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P'), null, 'no es 3.x');
  assert.equal(puntuacionCvss(''), null);
  assert.equal(puntuacionCvss('CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'), null, 'AV invalido');
});

test('bandaCvss: los cortes de la especificacion', () => {
  assert.equal(bandaCvss(0), 'low');
  assert.equal(bandaCvss(3.9), 'low');
  assert.equal(bandaCvss(4.0), 'moderate');
  assert.equal(bandaCvss(6.9), 'moderate');
  assert.equal(bandaCvss(7.0), 'high');
  assert.equal(bandaCvss(8.9), 'high');
  assert.equal(bandaCvss(9.0), 'critical');
  assert.equal(bandaCvss(10), 'critical');
});

test('severidadDeVector: banda o null, nunca un valor por defecto', () => {
  assert.equal(severidadDeVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H'), 'critical');
  assert.equal(severidadDeVector('CVSS:3.1/AV:L/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:H'), 'high');
  assert.equal(severidadDeVector('no-es-un-vector'), null);
});

test('severidadDeAviso: cubre banda explicita, vector en cadena y objeto {score,vector}', () => {
  assert.equal(severidadDeAviso({ severity: 'medium' }), 'moderate', 'npm dice medium');
  assert.equal(severidadDeAviso({ severity: 'informational' }), 'low', 'RUSTSEC antiguo');
  assert.equal(severidadDeAviso({ cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H' }), 'critical');
  assert.equal(severidadDeAviso({ cvss: { score: 5.3 } }), 'moderate');
  assert.equal(severidadDeAviso({ cvss: { vector: 'CVSS:3.1/AV:L/AC:L/PR:H/UI:N/S:U/C:L/I:N/A:N' } }), 'low');
  assert.equal(severidadDeAviso({ cvss: null }), null, 'sin cvss no hay banda');
  assert.equal(severidadDeAviso({}), null);
  assert.equal(severidadDeAviso(null), null);
});

test('bandaDeclarada: normaliza lo que no es una banda conocida', () => {
  assert.equal(bandaDeclarada('CRITICAL'), 'critical');
  assert.equal(bandaDeclarada('info'), 'low');
  assert.equal(bandaDeclarada('urgent'), null);
  assert.equal(bandaDeclarada(7), null);
});
