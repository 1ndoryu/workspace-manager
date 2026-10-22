/* Pruebas del check de versión (2026-10-22). [por que] El check es una compuerta de cierre: si
 * deja de detectar un desfase, el nav diría «actualizada» mientras el exe es otro. Se prueba con
 * datos en memoria, sin tocar los ficheros reales. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallosVersion, siguienteParche } from './version.mjs';

const base = { package: '1.2.3', tauri: '1.2.3', changelog: '# Changelog\n\n## [1.2.3] — 2026-10-22\n' };

test('versión coherente no reporta fallos', () => {
  assert.deepEqual(fallosVersion(base), []);
});

test('detecta que package.json y tauri.conf.json no coinciden', () => {
  const fallos = fallosVersion({ ...base, tauri: '1.2.2' });
  assert.equal(fallos.length, 1);
  assert.match(fallos[0], /versiones distintas/);
});

test('exige la sección de la versión en el changelog', () => {
  const fallos = fallosVersion({ ...base, changelog: '## [1.2.2]\n' });
  assert.equal(fallos.length, 1);
  assert.match(fallos[0], /falta la sección «## \[1\.2\.3\]»/);
});

test('acepta la sección con sufijo de fecha y no confunde 1.2.30 con 1.2.3', () => {
  assert.deepEqual(fallosVersion({ ...base, changelog: '## [1.2.3] — 2026-10-22\n' }), []);
  const fallos = fallosVersion({ ...base, changelog: '## [1.2.30]\n' });
  assert.equal(fallos.length, 1);
});

test('rechaza versiones que no son semver de tres números', () => {
  const fallos = fallosVersion({ ...base, package: 'v1.2', tauri: 'v1.2', changelog: '## [v1.2]' });
  assert.match(fallos.join(' '), /no semver/);
});

test('--subir calcula el siguiente parche', () => {
  assert.equal(siguienteParche('1.2.3'), '1.2.4');
  assert.equal(siguienteParche('0.9.9'), '0.9.10');
  assert.equal(siguienteParche('raro'), null);
});
