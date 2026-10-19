/* Fábrica de almacén persistido: frescura, poda, filtro al cargar y persistencia.
 * [por qué] Es la mecánica común de los dos almacenes del gate; si se rompe aquí,
 * se rompen los dos a la vez, así que se prueba directamente. Escribe en un
 * directorio temporal propio de cada ejecución. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearAlmacenPersistido } from './almacenPersistido.js';

type Dato = { estado: string };
const esCacheable = (d: Dato) => d.estado !== 'error';

function rutaTemporal(): string {
  return join(mkdtempSync(join(tmpdir(), 'almacen-persistido-')), 'cache.json');
}

test('sirve solo si la frescura coincide y no guarda lo no cacheable', () => {
  const almacen = crearAlmacenPersistido<Dato>(rutaTemporal(), esCacheable);
  almacen.guardar('a', 'f1', { estado: 'ok' });
  assert.deepEqual(almacen.frescos('a', 'f1'), { estado: 'ok' });
  assert.equal(almacen.frescos('a', 'f2'), null);

  almacen.guardar('b', 'f1', { estado: 'error' });
  assert.equal(almacen.leer('b'), null);
});

test('podar elimina las claves que ya no existen', () => {
  const almacen = crearAlmacenPersistido<Dato>(rutaTemporal(), esCacheable);
  almacen.guardar('a', 'f', { estado: 'ok' });
  almacen.guardar('b', 'f', { estado: 'ok' });
  almacen.podar(new Set(['a']));
  assert.equal(almacen.leer('b'), null);
  assert.deepEqual(almacen.leerTodas(), [{ estado: 'ok' }]);
});

test('al cargar descarta lo que la regla actual ya no admite y persiste lo guardado', () => {
  const ruta = rutaTemporal();
  writeFileSync(
    ruta,
    JSON.stringify({ viejo: { fresco: 'f', dato: { estado: 'error' } }, bueno: { fresco: 'f', dato: { estado: 'ok' } } }),
  );
  const almacen = crearAlmacenPersistido<Dato>(ruta, esCacheable);
  assert.equal(almacen.leer('viejo'), null);
  assert.deepEqual(almacen.leer('bueno'), { estado: 'ok' });

  almacen.guardar('nuevo', 'f', { estado: 'conHallazgos' });
  const enDisco = JSON.parse(readFileSync(ruta, 'utf8')) as Record<string, unknown>;
  assert.ok('nuevo' in enDisco && 'bueno' in enDisco && !('viejo' in enDisco));
});

test('sin fichero previo arranca vacío sin error', () => {
  const almacen = crearAlmacenPersistido<Dato>(rutaTemporal(), esCacheable);
  assert.deepEqual(almacen.leerTodas(), []);
});
