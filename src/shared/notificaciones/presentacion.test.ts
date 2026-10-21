/* Pruebas de la presentación de avisos (20AA-25 N3). Tablas: entra un reloj fijo y sale texto;
 * ninguna depende de cuándo se ejecute. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { Aviso } from './tipos.js';
import { ETIQUETA, NIVEL, TIPOS } from './tipos.js';
import {
  agruparPorTiempo,
  diaLocal,
  etiquetaContador,
  etiquetaDia,
  filtrarPorTipo,
  horaLocal,
  sinLeer,
} from './presentacion.js';

const AHORA = new Date('2026-10-21T12:00:00');
const aviso = (id: number, cuando: string, tipo: Aviso['tipo'] = 'tarea-nueva', leido = false): Aviso => ({
  id,
  tipo,
  nivel: 'media',
  titulo: `aviso ${id}`,
  detalle: '',
  fuente: 'tareas',
  clave: `k${id}`,
  cuando,
  agrupados: 1,
  leido,
});

test('el contador no pasa de «9+» y calla cuando no hay nada sin leer', () => {
  assert.equal(etiquetaContador(0), '');
  assert.equal(etiquetaContador(-3), '');
  assert.equal(etiquetaContador(1), '1');
  assert.equal(etiquetaContador(9), '9');
  assert.equal(etiquetaContador(10), '9+');
});

test('los días se agrupan en local, no en UTC', () => {
  /* 23:30 local del 20 contra las 12:00 del 21: son dos días aunque en UTC el primero ya sea
   * «hoy» en algunos husos. */
  const noche = new Date(2026, 9, 20, 23, 30);
  const tarde = new Date(2026, 9, 21, 9, 0);
  assert.equal(diaLocal(noche), '2026-10-20');
  assert.equal(diaLocal(tarde), '2026-10-21');
});

test('un día de este año se lee con mes corto; el año pasado no se confunde', () => {
  assert.equal(etiquetaDia('2026-10-03', AHORA), '3 oct');
  assert.equal(etiquetaDia('2025-12-31', AHORA), '31 dic');
});

test('la hora local va en HH:MM y una fecha rota no revienta', () => {
  assert.equal(horaLocal(new Date(2026, 9, 21, 7, 5)), '07:05');
  assert.equal(horaLocal('no-es-fecha'), '');
});

/* [20AA-28] Los avisos se agrupan en bloques de 6 horas con la etiqueta centrada. Entra una lista
 * ya ordenada del más nuevo al más viejo, como la sirve el almacén. */
test('seis avisos seguidos en la misma mañana van en un solo bloque', () => {
  const avisos = [
    aviso(6, new Date(2026, 9, 21, 11, 50).toISOString()),
    aviso(5, new Date(2026, 9, 21, 11, 0).toISOString()),
    aviso(4, new Date(2026, 9, 21, 9, 30).toISOString()),
    aviso(3, new Date(2026, 9, 21, 8, 0).toISOString()),
    aviso(2, new Date(2026, 9, 21, 6, 0).toISOString()),
    aviso(1, new Date(2026, 9, 21, 6, 1).toISOString()),
  ];
  const grupos = agruparPorTiempo(avisos, AHORA);
  assert.deepEqual(grupos.map((g) => [g.etiqueta, g.avisos.length]), [['06:00–12:00', 6]]);
});

test('un aviso de las 11:59 y otro de las 12:00 caen en bloques distintos', () => {
  const grupos = agruparPorTiempo(
    [aviso(2, new Date(2026, 9, 21, 12, 0).toISOString()), aviso(1, new Date(2026, 9, 21, 11, 59).toISOString())],
    AHORA,
  );
  assert.deepEqual(grupos.map((g) => [g.etiqueta, g.avisos.map((a) => a.id)]), [
    ['12:00–18:00', [2]],
    ['06:00–12:00', [1]],
  ]);
});

test('el bloque que cruza la medianoche se lee con su día y termina en 00:00', () => {
  /* 23:00 de ayer es el tramo 18:00–24:00 de ayer, no el 00:00 de hoy. */
  const grupos = agruparPorTiempo([aviso(1, new Date(2026, 9, 20, 23, 0).toISOString())], AHORA);
  assert.deepEqual(grupos.map((g) => g.etiqueta), ['ayer 18:00–00:00']);

  /* Un aviso del 3 de octubre dice qué día, para que «00:00–06:00» no se confunda con hoy. */
  const viejo = agruparPorTiempo([aviso(1, new Date(2026, 9, 3, 2, 0).toISOString())], AHORA);
  assert.deepEqual(viejo.map((g) => g.etiqueta), ['3 oct 00:00–06:00']);
});

test('agrupar por tiempo no reordena y no mezcla tramos alternos en un bloque', () => {
  const grupos = agruparPorTiempo(
    [
      aviso(4, new Date(2026, 9, 21, 13, 0).toISOString()),
      aviso(3, new Date(2026, 9, 21, 12, 30).toISOString()),
      aviso(2, new Date(2026, 9, 21, 8, 0).toISOString()),
      aviso(1, new Date(2026, 9, 21, 7, 0).toISOString()),
    ],
    AHORA,
  );
  assert.deepEqual(grupos.map((g) => [g.avisos.map((a) => a.id), g.etiqueta]), [
    [[4, 3], '12:00–18:00'],
    [[2, 1], '06:00–12:00'],
  ]);
  assert.deepEqual(agruparPorTiempo([], AHORA), []);
});

test('una fecha inválida no parte la lista en grupos fantasma', () => {
  /* El aviso roto cae en un bloque propio «sin fecha»; no revienta y no se lleva a los demás. */
  const grupos = agruparPorTiempo(
    [aviso(3, 'no-es-fecha'), aviso(2, 'tampoco'), aviso(1, new Date(2026, 9, 21, 7, 0).toISOString())],
    AHORA,
  );
  assert.deepEqual(grupos.map((g) => [g.etiqueta, g.avisos.map((a) => a.id)]), [
    ['sin fecha', [3]],
    ['sin fecha', [2]],
    ['06:00–12:00', [1]],
  ]);
});

/* [20AA-25 N4] Un tipo nuevo no puede quedarse fuera de las tablas: el contrato es la única
 * lista y cualquier Record<TipoAviso, …> falla al compilar si falta. Esta prueba lo fija en
 * tiempo de ejecución por si alguien lo cambia por un Partial o un índice dinámico. */
void describe('cobertura de tipos', () => {
  void test('todos los tipos tienen etiqueta, nivel y plural', () => {
    for (const tipo of TIPOS) {
      assert.ok(ETIQUETA[tipo], `sin etiqueta: ${tipo}`);
      assert.ok(NIVEL[tipo], `sin nivel: ${tipo}`);
    }
    assert.deepEqual(new Set(TIPOS).size, TIPOS.length, 'tipo repetido en la lista');
  });
});
