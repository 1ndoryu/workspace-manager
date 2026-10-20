/* Pruebas de la construcción de comandos remotos: una clave de entorno mal formada no
 * puede colar órdenes en la línea que ejecuta la VPS; y el PATH de node llega a npm. */
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { asignacionesEntorno, comandoAnalisis, comandoCompilar } from './comandos.js';

test('asignacionesEntorno acepta nombres POSIX y entrecomilla el valor', () => {
  assert.deepEqual(asignacionesEntorno({ GLORY_SENTINEL_SOURCE_PATH: "/a b's" }), [
    "GLORY_SENTINEL_SOURCE_PATH='/a b'\\''s'",
  ]);
});

test('asignacionesEntorno rechaza una clave con separadores de orden', () => {
  assert.throws(() => asignacionesEntorno({ 'A=1; rm -rf ~ #': 'x' }), /no válido/);
  assert.throws(() => asignacionesEntorno({ 'A B': 'x' }), /no válido/);
});

test('comandoAnalisis no emite claves sin validar', () => {
  assert.throws(
    () => comandoAnalisis({ env: { 'X;id': '1' }, node: 'node', cli: '/c.js', verbo: 'analyze', workspace: '/w' }),
    /no válido/,
  );
});

/* [por que] El fallo que cubren: `npm ci` ejecuta el `prepare` del runtime, que llama a `npm`;
 * sin la carpeta de node en el PATH de ese paso, la compilación se rompe con «npm: not found». */
const NODE_DIR = '/opt/nodo/bin';
const BASE = '/srv/taller/_quality-tools/x/varsense';

const orden = comandoCompilar({
  base: BASE,
  npm: `${NODE_DIR}/npm`,
  nodeDir: NODE_DIR,
  huella: 'h',
  huellaLock: 'l',
  marca: `${BASE}/.fuentes-sha`,
  cli: `${BASE}/dist/cli/index.js`,
});

/* Prefijo exacto que pone comandoCompilar delante de cada invocación de npm. */
const PREFIJO_PATH = `PATH='${NODE_DIR}:'"$PATH" `;

describe('comandoCompilar: el PATH de node llega a los dos pasos de npm', () => {
  it('npm ci lleva el PATH con la carpeta de node (su prepare necesita npm)', () => {
    assert.ok(orden.includes(`${PREFIJO_PATH}'${NODE_DIR}/npm' ci `), 'npm ci sin PATH de node');
  });

  it('npm run compile lleva el mismo PATH', () => {
    assert.ok(orden.includes(`${PREFIJO_PATH}'${NODE_DIR}/npm' --prefix `), 'npm --prefix sin PATH de node');
    assert.ok(orden.includes(' run -s compile'));
  });
});
