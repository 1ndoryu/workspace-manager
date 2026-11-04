/* Túnel inverso (04AB-1): pares declarados, lectura de `-R` en una línea de comandos y atribución
 * del ssh a su ficha. Puras: no se abre ningún ssh. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paresTunelInverso, reenviosInversos, tunelInversoDe } from '../../doctor.mjs';

const ficha = { id: 'x', host: 'taller-remoto', tunelInverso: [[8071, 8070], [8071, 8070]] };

test('paresTunelInverso: sin repetidos y vacío si la ficha no lo declara', () => {
  assert.deepEqual(paresTunelInverso(ficha), [[8071, 8070]]);
  assert.deepEqual(paresTunelInverso({ id: 'y', host: 'taller-remoto' }), []);
});

test('reenviosInversos: lee `-R` con y sin bind explícito y no confunde `-L`', () => {
  assert.deepEqual(reenviosInversos('ssh -N -R 127.0.0.1:8071:127.0.0.1:8070 taller-remoto'), [[8071, 8070]]);
  assert.deepEqual(reenviosInversos('ssh -N -R 8071:localhost:8070 taller-remoto'), [[8071, 8070]]);
  assert.deepEqual(reenviosInversos('ssh -N -L 127.0.0.1:3105:127.0.0.1:3105 taller-remoto'), []);
  assert.deepEqual(reenviosInversos(null), []);
});

test('tunelInversoDe: mismo host y solo pares declarados', () => {
  const ssh = (cmd) => ({ imagen: 'ssh.exe', cmd, creado: '2026-11-04T00:00:00Z' });
  assert.equal(tunelInversoDe(ssh('ssh -N -R 127.0.0.1:8071:127.0.0.1:8070 taller-remoto'), ficha), true);
  // Otro puerto no declarado: no es de esta ficha (no se cierra por error).
  assert.equal(tunelInversoDe(ssh('ssh -N -R 127.0.0.1:9999:127.0.0.1:8070 taller-remoto'), ficha), false);
  // Un túnel directo no es un inverso.
  assert.equal(tunelInversoDe(ssh('ssh -N -L 127.0.0.1:3105:127.0.0.1:3105 taller-remoto'), ficha), false);
  assert.equal(tunelInversoDe({ imagen: 'node.exe', cmd: '-R 8071:127.0.0.1:8070 taller-remoto' }, ficha), false);
});
