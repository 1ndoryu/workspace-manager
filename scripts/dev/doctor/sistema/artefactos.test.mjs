/* Veredictos de artefactos entre proyectos (20AA-7). Puros: sin ssh ni disco.
 * Se corre con: node --test scripts/dev/doctor/sistema/artefactos.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { veredicto } from './artefactos.mjs';

// Hechos base: producto compilado despues de lo consumido, e igual a lo instalado.
const alDia = {
  consumidoEn: '1000',
  productoEn: '2000',
  hashProducto: 'aaa',
  tieneInstalado: true,
  hashInstalado: 'aaa',
};

test('producto posterior a lo consumido e igual a lo instalado: al dia', () => {
  assert.equal(veredicto(alDia).veredicto, 'al-dia');
});

test('lo consumido cambio despues del producto: desactualizado', () => {
  assert.equal(veredicto({ ...alDia, consumidoEn: '3000' }).veredicto, 'desactualizado');
});

test('mismo segundo no es desactualizado (segundos enteros, sin redondeo hacia arriba)', () => {
  assert.equal(veredicto({ ...alDia, consumidoEn: '2000' }).veredicto, 'al-dia');
});

test('sin producto compilado', () => {
  assert.equal(veredicto({ ...alDia, productoEn: '' }).veredicto, 'sin-producto');
});

test('compilado pero no instalado', () => {
  assert.equal(veredicto({ ...alDia, tieneInstalado: false, hashInstalado: null }).veredicto, 'sin-instalar');
});

test('instalado distinto de lo compilado: se compilo y no se copio', () => {
  assert.equal(veredicto({ ...alDia, hashInstalado: 'bbb' }).veredicto, 'instalado-distinto');
});

test('sin lo consumido en la 89 no se acusa al producto', () => {
  assert.equal(veredicto({ ...alDia, consumidoEn: '' }).veredicto, 'sin-dato');
});

/* El orden importa: `sin-producto` gana a `sin-instalar` (sin producto no hay
 * nada que copiar), y `sin-dato` gana a todo (no se midio nada). */
test('orden de precedencia de los veredictos', () => {
  assert.equal(veredicto({ consumidoEn: '', productoEn: '', tieneInstalado: false }).veredicto, 'sin-dato');
  assert.equal(veredicto({ consumidoEn: '1', productoEn: '', tieneInstalado: false }).veredicto, 'sin-producto');
  assert.equal(
    veredicto({ consumidoEn: '9', productoEn: '1', tieneInstalado: false }).veredicto,
    'desactualizado',
    'desactualizado gana a sin-instalar: lo primero es que el producto no embebe el front nuevo',
  );
});
