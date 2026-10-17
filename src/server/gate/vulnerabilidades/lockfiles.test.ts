/* Deteccion de lockfiles: pura, sin disco ni audit. `existe` y `subcarpetas` se
 * inyectan, asi que el fixture es un conjunto de rutas. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { detectarLockfiles } from './lockfiles.js';

const R = 'C:/proy';

test('detectarLockfiles: pnpm gana a npm en la misma carpeta y audita cada subcarpeta', () => {
  const existen = new Set([
    join(R, 'pnpm-lock.yaml'),
    join(R, 'package-lock.json'),
    join(R, 'Cargo.lock'),
    join(R, 'frontend', 'package-lock.json'),
    join(R, 'core-rs', 'Cargo.lock'),
  ]);
  /* Las subcarpetas se inyectan: en disco no hay nada, el fixture es el set. */
  const locks = detectarLockfiles(R, (ruta) => existen.has(ruta), () => ['core-rs', 'frontend']);
  assert.deepEqual(
    locks.map((l) => [l.lockfile, l.gestor]),
    [
      ['pnpm-lock.yaml', 'pnpm'],
      ['Cargo.lock', 'cargo'],
      ['core-rs/Cargo.lock', 'cargo'],
      ['frontend/package-lock.json', 'npm'],
    ],
  );
});

/* La lista de carpetas sale del disco, no de nombres conocidos: sin ella solo se
 * mira la raiz, asi que un lockfile en una subcarpeta con cualquier nombre cuenta. */
test('detectarLockfiles: las carpetas se leen del proyecto, no de una lista fija', () => {
  const existen = new Set([join(R, 'web', 'pnpm-lock.yaml'), join(R, 'node_modules', 'x', 'package-lock.json')]);
  const locks = detectarLockfiles(R, (ruta) => existen.has(ruta), () => ['node_modules', 'web']);
  assert.deepEqual(locks.map((l) => l.lockfile), ['web/pnpm-lock.yaml'], 'node_modules no se audita');
});

test('detectarLockfiles: sin lockfile devuelve lista vacia', () => {
  assert.deepEqual(detectarLockfiles(R, () => false, () => []), []);
});

