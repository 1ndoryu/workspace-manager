/* Decisión de destino (VPS / aquí / local) y rutas de la réplica. Puros.
 * Fixtures genéricos: ningún host, usuario ni ruta real de un equipo concreto. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { cargarTaller, comandoEnVps, decidirDonde, dentroDe, dirRemotoDe, dirRemotoDeHerramienta, ejecutarEnVps, mensajeSinVps } from './vps.mjs';

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

test('decidirDonde: sin VPS configurada degrada a este equipo y lo dice', () => {
  const r = decidirDonde([], null, 'portatil-ejemplo');
  assert.equal(r.donde, 'local');
  assert.match(r.aviso, /sin taller configurado.*este equipo/);
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

test('dentroDe: la raíz y sus subcarpetas cuentan como dentro; hermanas y padres, no', () => {
  assert.equal(dentroDe(RAIZ, RAIZ), true);
  assert.equal(dentroDe(RAIZ, path.join(RAIZ, '.quality-tools')), true);
  assert.equal(dentroDe(RAIZ, path.resolve('proyecto-ejemplo-2')), false);
  assert.equal(dentroDe(RAIZ, path.dirname(RAIZ)), false);
});

test('dirRemotoDeHerramienta: carpeta por commit fuera de la réplica, en /var/tmp por defecto', () => {
  assert.equal(dirRemotoDeHerramienta(TALLER, 'sentinel', 'abc123'), '/var/tmp/glory-quality/sentinel/abc123');
  assert.equal(
    dirRemotoDeHerramienta({ ...TALLER, dirRemotoHerramientas: '/srv/herr' }, 'sentinel', 'abc123'),
    '/srv/herr/sentinel/abc123',
  );
});

test('comandoEnVps: usa el candado y el preludio de la configuración, y entra en el directorio', () => {
  const cmd = comandoEnVps(TALLER, '/srv/taller/proyecto', ['npm', 'run', 'build']);
  assert.match(cmd, /^candado bash -lc /);
  assert.match(cmd, /RUTA_EJEMPLO=1/);
  // [por que] shQuote entrecomilla cada argumento: se comprueban las piezas, no la línea literal.
  assert.match(cmd, /\/srv\/taller\/proyecto/);
  assert.match(cmd, /npm/);
  assert.match(cmd, /build/);
  // [por que 10AA-3] Toda orden en la 89 va marcada como taller: su `.git` es un espejo
  // de Mutagen que no se sincroniza y no vale como fuente de verdad.
  assert.match(cmd, /export GLORY_TALLER=1;/);
});

test('comandoEnVps: sin preludio en la configuración no añade nada al comando', () => {
  const sinPreludio = { ...TALLER, preludio: undefined };
  assert.doesNotMatch(comandoEnVps(sinPreludio, '/srv/taller/proyecto', ['true']), /RUTA_EJEMPLO/);
});

test('ejecutarEnVps: aplica el tope por defecto (30 min) y el de taller.json si lo hay', () => {
  // [por que] Sin tope una orden colgada bloqueaba el gate; se comprueba que el tope llega a spawnSync.
  const capturas = [];
  const ejecutor = (bin, args, opciones) => (capturas.push(opciones), { status: 0 });
  ejecutarEnVps(TALLER, '/srv/taller/proyecto', ['true'], { ejecutor });
  ejecutarEnVps({ ...TALLER, timeoutRemotoMs: 5000 }, '/srv/taller/proyecto', ['true'], { ejecutor });
  assert.equal(capturas[0].timeout, 30 * 60_000);
  assert.equal(capturas[1].timeout, 5000);
});

test('ejecutarEnVps: el timeout de spawnSync llega como status null y se nombra', () => {
  // [por que] Al cortar por tiempo spawnSync devuelve status null y error ETIMEDOUT; mensajeSinVps lo nombra.
  const ejecutor = () => ({ status: null, error: Object.assign(new Error('spawnSync ssh ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
  const r = ejecutarEnVps(TALLER, '/srv/taller/proyecto', ['true'], { ejecutor });
  assert.equal(r.status, null);
  assert.match(mensajeSinVps(r.status, TALLER.host), /se cortó por tiempo/);
});

test('mensajeSinVps: 255 de ssh es «no hay VPS»; otros códigos no', () => {
  assert.match(mensajeSinVps(255, 'remoto-ejemplo'), /no se pudo conectar a la VPS \(remoto-ejemplo\)/);
  assert.equal(mensajeSinVps(0, 'remoto-ejemplo'), null);
  assert.equal(mensajeSinVps(1, 'remoto-ejemplo'), null);
});

test('mensajeSinVps: status null (ssh no arrancó o se cortó por tiempo) se nombra, no sale mudo', () => {
  assert.match(mensajeSinVps(null, 'remoto-ejemplo'), /remoto-ejemplo\) no terminó.*se cortó por tiempo/);
});

test('cargarTaller: JSON corrupto falla nombrando el fichero y el remedio, no como «sin VPS»', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taller-prueba-'));
  try {
    const ruta = path.join(dir, 'taller.json');
    writeFileSync(ruta, '{ no es json');
    assert.throws(() => cargarTaller(ruta), /taller.json no es JSON válido .*sin VPS/);
    assert.equal(cargarTaller(path.join(dir, 'ausente.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
