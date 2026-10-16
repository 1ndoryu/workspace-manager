/* Tests de compararHallazgos (10AA-2 F9.4): puros, sin disco ni análisis. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claveHallazgo, compararHallazgos } from './comparacion.js';
import type { HallazgoSentinel } from '../../../shared/types.js';

function h(over: Partial<HallazgoSentinel> = {}): HallazgoSentinel {
  return {
    ruleId: 'regla-x',
    mensaje: 'algo',
    severidad: 'error',
    archivo: 'src/a.ts',
    linea: 10,
    ...over,
  };
}

test('claveHallazgo ignora la línea y distingue la fuente', () => {
  assert.equal(claveHallazgo(h({ linea: 1 })), claveHallazgo(h({ linea: 999 })));
  assert.notEqual(claveHallazgo(h()), claveHallazgo(h({ fuente: 'varsense' })));
  assert.equal(claveHallazgo(h()), claveHallazgo(h({ fuente: 'sentinel' })));
});

test('sin cambios: ningún hallazgo nuevo y todos resueltos en cero', () => {
  const base = [h(), h({ ruleId: 'otra', archivo: 'src/b.ts' })];
  const r = compararHallazgos(base, base);
  assert.deepEqual(r.nuevos, []);
  assert.equal(r.resueltos, 0);
});

test('un hallazgo movido de línea no cuenta como nuevo (regresion: editar por encima)', () => {
  const r = compararHallazgos([h({ linea: 10 })], [h({ linea: 42 })]);
  assert.deepEqual(r.nuevos, []);
});

test('hallazgo de regla o archivo distinto es nuevo, con su línea', () => {
  const nuevo = h({ ruleId: 'regla-y', archivo: 'src/c.ts', linea: 7 });
  const r = compararHallazgos([h()], [h(), nuevo]);
  assert.deepEqual(r.nuevos, [nuevo]);
});

test('duplicado en el mismo archivo: solo el exceso es nuevo (multiconjunto)', () => {
  const base = [h({ linea: 1 }), h({ linea: 2 })];
  const actuales = [h({ linea: 1 }), h({ linea: 2 }), h({ linea: 3 })];
  const r = compararHallazgos(base, actuales);
  assert.equal(r.nuevos.length, 1);
  assert.equal(r.nuevos[0].linea, 3);
});

test('hallazgos resueltos: entradas de la base que ya no aparecen', () => {
  const r = compararHallazgos([h(), h({ ruleId: 'otra' }), h({ ruleId: 'otra', linea: 99 })], [h({ ruleId: 'otra' })]);
  assert.deepEqual(r.nuevos, []);
  assert.equal(r.resueltos, 2);
});

test('base vacía: todo lo actual es nuevo', () => {
  const actuales = [h(), h({ ruleId: 'otra' })];
  const r = compararHallazgos([], actuales);
  assert.equal(r.nuevos.length, 2);
  assert.equal(r.resueltos, 0);
});

test('escalada de severidad en la misma clave sí es nueva (regresion: warning -> error)', () => {
  const r = compararHallazgos(
    [h({ severidad: 'warning', linea: 800 })],
    [h({ severidad: 'error', linea: 803 })],
  );
  assert.equal(r.nuevos.length, 1);
  assert.equal(r.nuevos[0].severidad, 'error');
  assert.equal(r.resueltos, 1);
});

test('bajar la severidad no cuenta como nuevo: el arreglo a medias no bloquea', () => {
  const r = compararHallazgos([h({ severidad: 'error' })], [h({ severidad: 'warning' })]);
  assert.deepEqual(r.nuevos, []);
  assert.equal(r.resueltos, 0);
});

test('escalada con la misma clave pero más grave: consume el leve y deja el grave de la base libre', () => {
  /* base: un warning y un error de la misma regla+archivo; ahora: un error.
   * El error actual se aparea con el error de la base, así que el warning
   * sobra y cuenta como resuelto; nada nuevo. */
  const r = compararHallazgos(
    [h({ severidad: 'warning' }), h({ severidad: 'error' })],
    [h({ severidad: 'error' })],
  );
  assert.deepEqual(r.nuevos, []);
  assert.equal(r.resueltos, 1);
});

test('una severidad desconocida no se lee como empeoramiento', () => {
  /* El tipo es una unión, pero la severidad llega de un JSON externo: el cast
   * reproduce lo que se cuela por el límite. */
  const desconocida = h({ severidad: 'nueva-regla' as HallazgoSentinel['severidad'] });
  const r = compararHallazgos([h({ severidad: 'information' })], [desconocida]);
  assert.deepEqual(r.nuevos, []);
});

test('dos escaladas de la misma clave cuentan las dos (multiconjunto)', () => {
  const r = compararHallazgos(
    [h({ severidad: 'warning', linea: 1 }), h({ severidad: 'warning', linea: 2 })],
    [h({ severidad: 'error', linea: 1 }), h({ severidad: 'error', linea: 2 })],
  );
  assert.equal(r.nuevos.length, 2);
  assert.equal(r.resueltos, 2);
});
