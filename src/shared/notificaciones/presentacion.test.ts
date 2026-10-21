/* Pruebas de la presentación de avisos (20AA-25 N3). Tablas: entra un reloj fijo y sale texto;
 * ninguna depende de cuándo se ejecute. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Aviso } from './tipos.js';
import {
  agruparPorDia,
  diaLocal,
  etiquetaContador,
  etiquetaDia,
  filtrarPorTipo,
  hace,
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

test('hace() distingue ahora, minutos, horas, días y semanas', () => {
  const hace2 = (ms: number): string => hace(new Date(AHORA.getTime() - ms), AHORA);
  assert.equal(hace2(0), 'ahora');
  assert.equal(hace2(20_000), 'ahora');
  assert.equal(hace2(5 * 60_000), 'hace 5 min');
  assert.equal(hace2(90 * 60_000), 'hace 2 h');
  assert.equal(hace2(30 * 3600_000), 'hace 1 d');
  assert.equal(hace2(21 * 24 * 3600_000), 'hace 3 sem');
  /* Reloj del servidor adelantado: no se anuncia un futuro. */
  assert.equal(hace(new Date(AHORA.getTime() + 60_000), AHORA), 'ahora');
  assert.equal(hace('no-es-fecha', AHORA), '');
});

test('los días se agrupan en local, no en UTC', () => {
  /* 23:30 local del 20 contra las 12:00 del 21: son dos días aunque en UTC el primero ya sea
   * «hoy» en algunos husos. */
  const noche = new Date(2026, 9, 20, 23, 30);
  const tarde = new Date(2026, 9, 21, 9, 0);
  assert.equal(diaLocal(noche), '2026-10-20');
  assert.equal(diaLocal(tarde), '2026-10-21');

  const grupos = agruparPorDia([aviso(2, tarde.toISOString()), aviso(1, noche.toISOString())], AHORA);
  assert.deepEqual(
    grupos.map((g) => [g.etiqueta, g.avisos.map((a) => a.id)]),
    [
      ['hoy', [2]],
      ['ayer', [1]],
    ],
  );
});

test('un día de este año se lee con mes corto; el año pasado no se confunde', () => {
  assert.equal(etiquetaDia('2026-10-03', AHORA), '3 oct');
  assert.equal(etiquetaDia('2025-12-31', AHORA), '31 dic');
});

test('agrupar no reordena: respeta el orden del almacén', () => {
  const avisos = [aviso(3, '2026-10-21T11:00:00'), aviso(2, '2026-10-21T10:00:00'), aviso(1, '2026-10-21T09:00:00')];
  const grupos = agruparPorDia(avisos, AHORA);
  assert.equal(grupos.length, 1);
  assert.deepEqual(grupos[0].avisos.map((a) => a.id), [3, 2, 1]);
  assert.deepEqual(agruparPorDia([], AHORA), []);
});

test('sinLeer cuenta sólo los no leídos y el filtro por tipo no toca el original', () => {
  const avisos = [aviso(1, '2026-10-21T09:00:00'), aviso(2, '2026-10-21T09:00:00', 'sitio-caido'), aviso(3, '2026-10-21T09:00:00', 'tarea-nueva', true)];
  assert.equal(sinLeer(avisos), 2);

  const soloTareas = filtrarPorTipo(avisos, 'tarea-nueva');
  assert.deepEqual(soloTareas.map((a) => a.id), [1, 3]);
  assert.equal(filtrarPorTipo(avisos, null).length, 3);
  assert.notEqual(filtrarPorTipo(avisos, null), avisos, 'devuelve copia: quien la ordene no altera el store');
});
