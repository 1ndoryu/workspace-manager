/* Tests de la escritura segura: la parte pura con texto fijo y la E/S sobre un directorio
 * temporal. [por que] 19AA-13: la separación entre puro y E/S queda cubierta aquí. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { diffLineas, eolDe, hashDe } from '../escritura.js';
import { escribirAtomico, leerFichero } from '../escritura.js';

const TMP = mkdtempSync(join(tmpdir(), 'escritura-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

test('diffLineas devuelve null si no hay cambios y el bloque cambiado si los hay', () => {
  assert.equal(diffLineas('a\nb\nc', 'a\nb\nc'), null);
  assert.deepEqual(diffLineas('a\nb\nc', 'a\nX\nc'), { desde: 2, quitar: ['b'], poner: ['X'] });
});

test('diffLineas admite inserciones y borrados al final', () => {
  assert.deepEqual(diffLineas('a\nb', 'a\nb\nc'), { desde: 3, quitar: [], poner: ['c'] });
  assert.deepEqual(diffLineas('a\nb\nc', 'a\nb'), { desde: 3, quitar: ['c'], poner: [] });
});

test('eolDe detecta CRLF y hashDe es estable', () => {
  assert.equal(eolDe('a\r\nb'), '\r\n');
  assert.equal(eolDe('a\nb'), '\n');
  assert.equal(hashDe('x'), hashDe('x'));
  assert.notEqual(hashDe('x'), hashDe('y'));
});

test('leerFichero y escribirAtomico ida y vuelta, y ausente', () => {
  const ruta = join(TMP, 'config.json');
  assert.deepEqual(leerFichero(ruta), { estado: 'ausente' });
  escribirAtomico(ruta, '{"a":1}\r\n');
  const lectura = leerFichero(ruta);
  assert.equal(lectura.estado, 'ok');
  if (lectura.estado === 'ok') {
    assert.equal(lectura.contenido, '{"a":1}\r\n');
    assert.equal(lectura.eol, '\r\n');
    assert.equal(lectura.hash, hashDe('{"a":1}\r\n'));
  }
  assert.equal(readFileSync(ruta, 'utf8'), '{"a":1}\r\n');
});

test('leerFichero rechaza carpetas y symlinks', () => {
  const carpeta = join(TMP, 'carpeta');
  mkdirSync(carpeta);
  assert.equal(leerFichero(carpeta).estado, 'invalido');
  const destino = join(TMP, 'destino.txt');
  writeFileSync(destino, 'x');
  const enlace = join(TMP, 'enlace.txt');
  try {
    symlinkSync(destino, enlace);
  } catch {
    return; /* sin permiso para symlinks en este equipo: el caso no se puede montar */
  }
  assert.equal(leerFichero(enlace).estado, 'invalido');
});
