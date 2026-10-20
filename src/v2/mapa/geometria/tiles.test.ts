/* Pruebas de los colores de conexión: la lista de proyectos pinta lo mismo que el mapa. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_HUB, coloresDeConexion } from './tiles.js';

test('sin conexiones no hay degradado', () => {
  assert.equal(coloresDeConexion([]), null);
});

test('una sola conexión se apaga hacia el borde neutro', () => {
  assert.deepEqual(coloresDeConexion(['vps89']), [COLOR_HUB.vps89, 'var(--v2-borde)']);
});

test('dos conexiones llevan el color de cada nodo, en orden', () => {
  assert.deepEqual(coloresDeConexion(['laptop', 'produccion']), [
    COLOR_HUB.laptop,
    COLOR_HUB.produccion,
  ]);
});

test('todos los nodos del mapa tienen color', () => {
  for (const id of ['laptop', 'vps89', 'produccion']) {
    assert.ok(COLOR_HUB[id], `falta el color de ${id}`);
  }
});
