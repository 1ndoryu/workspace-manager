/* Decisión de destino (VPS / emergencia --local / error sin VPS) y rutas de la réplica. Puros.
 * Fixtures genéricos: ningún host, usuario ni ruta real de un equipo concreto. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { comandoEnVps, decidirDonde, dirRemotoDe, mensajeSinVps } from './vps.mjs';

const TALLER = {
  host: 'remoto-ejemplo',
  hostnameTaller: 'equipo-taller',
  dirRemotoBase: '/srv/taller',
  lockWrapper: 'candado',
  preludio: 'export RUTA_EJEMPLO=1; ',
};
const RAIZ = path.resolve('proyecto-ejemplo');

test('decidirDonde: en el equipo del taller corre aquí', () => {
  assert.deepEqual(decidirDonde([], TALLER, 'equipo-taller'), { donde: 'aqui' });
});

test('decidirDonde: otro equipo con VPS configurada manda a la VPS', () => {
  assert.deepEqual(decidirDonde([], TALLER, 'portatil-ejemplo'), { donde: 'remoto' });
});

test('decidirDonde: sin VPS configurada falla con mensaje claro, nunca ejecuta en este equipo', () => {
  assert.throws(() => decidirDonde([], null, 'portatil-ejemplo'), /sin VPS configurada.*--local/);
});

test('decidirDonde: --local es la emergencia explícita y deja aviso', () => {
  const r = decidirDonde(['--local'], TALLER, 'portatil-ejemplo');
  assert.equal(r.donde, 'local');
  assert.match(r.aviso, /EMERGENCIA/);
  assert.equal(decidirDonde(['--local'], null, 'portatil-ejemplo').donde, 'local');
});

test('dirRemotoDe: réplica bajo dirRemotoBase/<id>/<ruta relativa>', () => {
  assert.equal(dirRemotoDe(TALLER, 'proyecto', RAIZ, RAIZ), '/srv/taller/proyecto');
  assert.equal(
    dirRemotoDe(TALLER, 'proyecto', RAIZ, path.join(RAIZ, '.quality-tools', 'herramienta')),
    '/srv/taller/proyecto/.quality-tools/herramienta',
  );
});

test('dirRemotoDe: carpeta fuera del proyecto no se replica', () => {
  assert.throws(() => dirRemotoDe(TALLER, 'proyecto', RAIZ, path.resolve('otro-proyecto')), /fuera de/);
});

test('comandoEnVps: usa el candado y el preludio de la configuración, y entra en el directorio', () => {
  const cmd = comandoEnVps(TALLER, '/srv/taller/proyecto', ['npm', 'run', 'build']);
  assert.match(cmd, /^candado bash -lc /);
  assert.match(cmd, /RUTA_EJEMPLO=1/);
  // [por que] shQuote entrecomilla cada argumento: se comprueban las piezas, no la línea literal.
  assert.match(cmd, /\/srv\/taller\/proyecto/);
  assert.match(cmd, /npm/);
  assert.match(cmd, /build/);
});

test('comandoEnVps: sin preludio en la configuración no añade nada al comando', () => {
  const sinPreludio = { ...TALLER, preludio: undefined };
  assert.doesNotMatch(comandoEnVps(sinPreludio, '/srv/taller/proyecto', ['true']), /RUTA_EJEMPLO/);
});

test('mensajeSinVps: 255 de ssh es «no hay VPS»; otros códigos no', () => {
  assert.match(mensajeSinVps(255, 'remoto-ejemplo'), /no se pudo conectar a la VPS \(remoto-ejemplo\)/);
  assert.equal(mensajeSinVps(0, 'remoto-ejemplo'), null);
  assert.equal(mensajeSinVps(1, 'remoto-ejemplo'), null);
});
