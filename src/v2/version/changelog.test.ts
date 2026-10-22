/* Pruebas de la lectura del changelog (2026-10-22). Funciones puras: un texto entra, líneas
 * salen. Lo que se fija aquí es lo que se vio roto en el panel: marcado en crudo y entradas
 * partidas por el ancho de columna. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretar, trozos } from './changelog.ts';

const EJEMPLO = `# Changelog

Nota de cabecera que no debe pintarse.

## [1.2.3] — 2026-10-22

### Cambiado

- **Una entrada** con \`código\` y un
  trozo en la línea siguiente.
- Otra entrada.
`;

test('descarta la cabecera del fichero y empieza en la primera sección', () => {
  const lineas = interpretar(EJEMPLO);
  assert.equal(lineas[0].tipo, 'seccion');
  assert.equal(lineas[0].texto, '[1.2.3] — 2026-10-22');
  assert.ok(!lineas.some((l) => l.texto.includes('cabecera')));
});

test('une la continuación de una entrada con la línea anterior', () => {
  const lineas = interpretar(EJEMPLO);
  const puntos = lineas.filter((l) => l.tipo === 'punto');
  assert.equal(puntos.length, 2);
  assert.equal(puntos[0].texto, '**Una entrada** con `código` y un trozo en la línea siguiente.');
});

test('separa la subtítulo de las entradas', () => {
  const tipos = interpretar(EJEMPLO).map((l) => l.tipo);
  assert.deepEqual(tipos, ['seccion', 'subtitulo', 'punto', 'punto']);
});

test('quita las marcas inline y conserva el texto', () => {
  assert.deepEqual(trozos('**El mapa** ya no miente'), [{ codigo: false, texto: 'El mapa ya no miente' }]);
  assert.deepEqual(trozos('ver [la guía](https://ejemplo/x)'), [{ codigo: false, texto: 'ver la guía' }]);
});

test('el código va en un trozo propio, sin las comillas invertidas', () => {
  assert.deepEqual(trozos('pasó a `sinServicio` aquí'), [
    { codigo: false, texto: 'pasó a ' },
    { codigo: true, texto: 'sinServicio' },
    { codigo: false, texto: ' aquí' },
  ]);
});
