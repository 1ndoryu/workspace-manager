/* 12AA-7: el `up` remoto nombra al proceso que ocupa un puerto ajeno (pid y comando) y no responde `ya-arriba`.
 * Puros: el script real corre en la 89 y se prueba allí con un fixture propio. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analizarDuenos, puertosDeSalida, resumenAjenos } from '../ficha.mjs';

test('puertosDeSalida: salida vacia (todas supervisadas) no inventa el puerto 0 (20AA-12)', () => {
  assert.deepEqual(puertosDeSalida('', [3110, 20241]), []);
  assert.deepEqual(puertosDeSalida('\n', [3110, 20241]), []);
});

test('puertosDeSalida: solo devuelve los puertos pedidos, como numeros', () => {
  assert.deepEqual(puertosDeSalida('3110\n20241\n', [3110, 20241]), [3110, 20241]);
  assert.deepEqual(puertosDeSalida('0\n3110\n', [3110]), [3110]);
});

test('analizarDuenos separa nuestro, ajeno, libre y pid no visible', () => {
  const salida = [
    '5179 nuestro 4321 node dist-server/index.js',
    '5180 ajeno 999 python3 -m http.server 5180',
    '5181 libre - -',
    '5182 ajeno - (pid no visible)',
  ].join('\n');
  const lineas = analizarDuenos(salida);
  assert.equal(lineas.length, 4);
  assert.deepEqual(lineas[0], { puerto: 5179, estado: 'nuestro', pid: 4321, cmd: 'node dist-server/index.js' });
  assert.deepEqual(lineas[1], { puerto: 5180, estado: 'ajeno', pid: 999, cmd: 'python3 -m http.server 5180' });
  assert.equal(lineas[2].pid, null);
  assert.equal(lineas[3].pid, null);
});

test('resumenAjenos nombra pid y comando; sin pid lo dice', () => {
  const r = resumenAjenos([
    { puerto: 5180, estado: 'ajeno', pid: 999, cmd: 'python3 -m http.server 5180' },
    { puerto: 5182, estado: 'ajeno', pid: null, cmd: '(pid no visible)' },
  ]);
  assert.equal(
    r,
    'puerto 5180 lo ocupa pid 999 (python3 -m http.server 5180), no el proyecto; puerto 5182 lo ocupa un proceso ajeno (pid no visible)',
  );
});
