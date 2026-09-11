/* certificacion.test.mjs — casos de la caché de certificación (109A-9).
 *
 * [por que] La caché ahorra ~5 min por consumidor, pero solo es aceptable si es
 * fail-closed: un hit falso certificaría un commit sin haberlo compilado ni
 * testeado. Estos casos fijan las cinco formas de fallar (ausente, corrupta,
 * esquema, campos distintos, resultado no válido), la separación por scripts y
 * por entorno, y la atomicidad de la escritura.
 *
 * Uso: node --test scripts/quality/certificacion.test.mjs  (npm run quality:cert:test)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  directorioCertificaciones,
  escribirCertificacion,
  huellaClave,
  leerCertificacion,
  nombreCertificacion,
  rutaCertificacion,
} from './certificacion.mjs';

const COMMIT = 'a3f5607e94eb92bfebbc197ef3836648e176a00e';
const OTRO_COMMIT = '129c24e0000000000000000000000000000000ab';

const BASE = {
  tool: 'sentinel',
  commit: COMMIT,
  buildScript: 'compile',
  testScript: 'test:unit',
  platform: 'win32',
  nodeVersion: 'v24.13.0',
};

function temporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cert-109a9-'));
}

/* --- caso 1: sin entrada previa es un miss --------------------------------- */
test('miss cuando no hay certificación', () => {
  const { entrada, motivo } = leerCertificacion(BASE, { dir: temporal() });
  assert.equal(entrada, null);
  assert.equal(motivo, 'ausente');
});

/* --- caso 2: el ciclo escribir→leer es un hit ------------------------------ */
test('hit tras certificar, con la clave registrada', () => {
  const dir = temporal();
  const { ruta } = escribirCertificacion(BASE, {}, { dir });
  assert.ok(fs.existsSync(ruta), 'la certificación debe quedar escrita');

  const { entrada, motivo } = leerCertificacion(BASE, { dir });
  assert.equal(motivo, null);
  assert.equal(entrada.commit, COMMIT);
  assert.equal(entrada.compile, 'passed');
  assert.equal(entrada.suite, 'passed');
  assert.equal(entrada.tool, 'sentinel');
});

/* --- caso 3: otra suite no puede recibir el hit ---------------------------- */
test('miss si cambia el testScript (otra suite no hereda la certificación)', () => {
  const dir = temporal();
  escribirCertificacion(BASE, {}, { dir });

  const distinto = { ...BASE, testScript: 'smoke:lsp' };
  assert.notEqual(nombreCertificacion(BASE), nombreCertificacion(distinto), 'el nombre debe incluir la huella de scripts');
  assert.notEqual(huellaClave(BASE), huellaClave(distinto));
  assert.equal(leerCertificacion(distinto, { dir }).entrada, null);
});

/* --- caso 4: otro entorno (plataforma/runtime) es otro hecho --------------- */
test('miss si cambia la plataforma o el runtime', () => {
  const dir = temporal();
  escribirCertificacion(BASE, {}, { dir });
  assert.equal(leerCertificacion({ ...BASE, platform: 'linux' }, { dir }).entrada, null);
  assert.equal(leerCertificacion({ ...BASE, nodeVersion: 'v20.11.0' }, { dir }).entrada, null);
});

/* --- caso 5: entrada corrupta --------------------------------------------- */
test('miss si la entrada está corrupta o no es un objeto', () => {
  const dir = temporal();
  const ruta = rutaCertificacion(BASE, { dir });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ruta, '{ esto no es json');
  assert.equal(leerCertificacion(BASE, { dir }).motivo, 'corrupta');

  fs.writeFileSync(ruta, '["array"]');
  assert.equal(leerCertificacion(BASE, { dir }).motivo, 'corrupta');
});

/* --- caso 6: esquema distinto -------------------------------------------- */
test('miss si el esquema no es el vigente', () => {
  const dir = temporal();
  const ruta = rutaCertificacion(BASE, { dir });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ruta, `${JSON.stringify({ schemaVersion: 99, ...BASE, compile: 'passed', suite: 'passed' })}\n`);
  assert.equal(leerCertificacion(BASE, { dir }).motivo, 'esquema');
});

/* --- caso 7: campos que no coinciden con la clave ------------------------- */
test('miss si la entrada no corresponde al commit pedido', () => {
  const dir = temporal();
  // Se escribe una certificación válida de OTRO commit y se renombra al nombre
  // del commit pedido: el nombre del fichero no basta, deben coincidir los campos.
  const { ruta: rutaOtro, entrada } = escribirCertificacion({ ...BASE, commit: OTRO_COMMIT }, {}, { dir });
  const rutaFalsa = rutaCertificacion(BASE, { dir });
  fs.writeFileSync(rutaFalsa, `${JSON.stringify(entrada, null, 2)}\n`);
  assert.ok(fs.existsSync(rutaOtro));

  const { entrada: leida, motivo } = leerCertificacion(BASE, { dir });
  assert.equal(leida, null);
  assert.equal(motivo, 'campo commit');
});

/* --- caso 8: resultado no utilizable ------------------------------------- */
test('miss si compile no está en verde o la suite no corresponde', () => {
  const dir = temporal();
  const ruta = rutaCertificacion(BASE, { dir });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ruta, `${JSON.stringify({ schemaVersion: 1, ...BASE, compile: 'failed', suite: 'passed' })}\n`);
  assert.equal(leerCertificacion(BASE, { dir }).motivo, 'compile');

  fs.writeFileSync(ruta, `${JSON.stringify({ schemaVersion: 1, ...BASE, compile: 'passed', suite: 'not-configured' })}\n`);
  assert.equal(leerCertificacion(BASE, { dir }).motivo, 'suite');
});

/* --- caso 9: sin suite declarada el resultado esperado es not-configured --- */
test('sin testScript la certificación esperada es not-configured', () => {
  const dir = temporal();
  const sinSuite = { ...BASE, testScript: null };
  const { entrada } = escribirCertificacion(sinSuite, {}, { dir });
  assert.equal(entrada.suite, 'not-configured');
  assert.equal(leerCertificacion(sinSuite, { dir }).motivo, null);
});

/* --- caso 10: la escritura no deja temporales ----------------------------- */
test('la escritura es atómica y no deja ficheros temporales', () => {
  const dir = temporal();
  escribirCertificacion(BASE, {}, { dir });
  escribirCertificacion({ ...BASE, commit: OTRO_COMMIT }, {}, { dir });
  const restos = fs.readdirSync(dir).filter(nombre => nombre.endsWith('.tmp'));
  assert.deepEqual(restos, [], 'no deben quedar .tmp');
  assert.equal(fs.readdirSync(dir).length, 2, 'una entrada por clave');
});

/* --- caso 11: ubicación de la caché -------------------------------------- */
test('la caché vive fuera de todo repo y respeta el override', () => {
  assert.equal(directorioCertificaciones({ GLORY_CERT_CACHE: 'C:\\tmp\\cert-test' }), 'C:\\tmp\\cert-test');
  const windows = directorioCertificaciones({ LOCALAPPDATA: 'C:\\Users\\Owner\\AppData\\Local' });
  assert.match(windows, /GlorySentinel[\\/]certificaciones$/u);
  const posix = directorioCertificaciones({ XDG_CACHE_HOME: '/home/x/.cache' });
  assert.equal(posix, path.join('/home/x/.cache', 'glory-sentinel', 'certificaciones'));
});
