import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analizarEscucha,
  argsTunel,
  comandoRemotoUp,
  esEntradaRemota,
  marcadorTunel,
  tunelEsNuestro,
  validarHostRemoto,
} from './remoto.mjs';

const config = { host: 'dev89', lockWrapper: 'cm-heavy' };
const entrada = { id: 'P', host: 'dev89', puertos: [3001], boton: [['cargo', 'run', '--release']] };

test('esEntradaRemota: solo con host no vacío', () => {
  assert.equal(esEntradaRemota({}), false);
  assert.equal(esEntradaRemota({ host: '' }), false);
  assert.equal(esEntradaRemota({ host: 'dev89' }), true);
});

test('validarHostRemoto rechaza otro host, requiere y puertos protegidos', () => {
  assert.match(validarHostRemoto({ ...entrada, host: 'otro' }, config), /no permitido/);
  assert.match(validarHostRemoto({ ...entrada, requiere: ['x'] }, config), /requiere/);
  assert.match(validarHostRemoto({ ...entrada, puertos: [8787] }, config), /protegidos/);
  assert.equal(validarHostRemoto(entrada, config), null);
});

test('argsTunel: reenvio solo a loopback, fail-closed y sin multiplexar', () => {
  const args = argsTunel(config, entrada);
  assert.ok(args.includes('ExitOnForwardFailure=yes'));
  assert.ok(args.includes('ControlMaster=no'));
  assert.ok(args.includes('ControlPath=none'));
  assert.ok(args.includes('127.0.0.1:3001:127.0.0.1:3001'));
  assert.equal(args.at(-1), 'dev89');
});

test('tunelEsNuestro: exige ssh, host y el reenvio del puerto', () => {
  const cmd = `ssh -N -L 127.0.0.1:3001:127.0.0.1:3001 dev89`;
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd }, config, entrada), true);
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd: 'ssh -N -L 127.0.0.1:4000:127.0.0.1:4000 dev89' }, config, entrada), false);
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'node.exe', cmd }, config, entrada), false);
  assert.equal(tunelEsNuestro(null, config, entrada), false);
  assert.deepEqual(marcadorTunel(config, entrada), ['dev89', '127.0.0.1:3001:127.0.0.1:3001']);
});

test('comandoRemotoUp: cargo detrás de cm-heavy, target propio e idempotente', () => {
  const rutas = { dirRemoto: '/home/usuario/taller/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoRemotoUp(config, rutas, 'P', 3001, ['cargo', 'run', '--release']);
  // Las palabras van entrecomilladas para el shell remoto: se comprueba el orden, no el texto literal.
  assert.match(cmd, /cm-heavy.*cargo/);
  assert.ok(cmd.includes('/var/tmp/glory-target/P_main'));
  assert.ok(cmd.includes('tmux has-session'));
  assert.ok(cmd.includes('dev-P-3001'));
});

test('comandoRemotoUp: comando no cargo no pasa por cm-heavy', () => {
  const rutas = { dirRemoto: '/home/usuario/taller/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoRemotoUp(config, rutas, 'P', 3001, ['npm', 'run', 'dev']);
  assert.equal(cmd.includes('cm-heavy'), false);
});

test('analizarEscucha: solo loopback no es publico; 0.0.0.0, * y [::] sí', () => {
  const linea = (local) => `LISTEN 0 128 ${local} 0.0.0.0:*`;
  assert.deepEqual(analizarEscucha(linea('127.0.0.1:3001'), 3001), { escucha: true, publicas: [] });
  assert.deepEqual(analizarEscucha(linea('[::1]:3001'), 3001), { escucha: true, publicas: [] });
  assert.deepEqual(analizarEscucha(linea('0.0.0.0:3001'), 3001).publicas, ['0.0.0.0:3001']);
  assert.deepEqual(analizarEscucha(linea('*:3001'), 3001).publicas, ['*:3001']);
  assert.deepEqual(analizarEscucha(linea('[::]:3001'), 3001).publicas, ['[::]:3001']);
});

test('analizarEscucha: no confunde puertos que terminan igual', () => {
  const salida = 'LISTEN 0 128 0.0.0.0:13001 0.0.0.0:*';
  assert.deepEqual(analizarEscucha(salida, 3001), { escucha: false, publicas: [] });
});
