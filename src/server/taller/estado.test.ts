/* Pruebas de las funciones puras de estado.ts: parser de sesiones Mutagen y registro de
 * conformidad. La lectura real (SSH, PowerShell, HTTP) no se prueba aquí: es E/S. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerRegistroConformidad, sesionesMutagenMalas } from './estado.js';

const BLOQUE_SANO = `Name: taller-RESTAURANTE
Identifier: sync_abc
Status: Watching for changes
`;

test('Mutagen: sesión en Watching no es mala', () => {
  assert.deepEqual(sesionesMutagenMalas(BLOQUE_SANO), []);
});

test('Mutagen: sesión pausada o con conflictos se marca con su estado', () => {
  const salida = `${BLOQUE_SANO}
Name: taller-MN-Inmobiliaria
Identifier: sync_def
Status: Paused
Name: taller-otra
Status: Watching for changes
Conflicts:
  a.txt
`;
  assert.deepEqual(sesionesMutagenMalas(salida), [
    'taller-MN-Inmobiliaria (Paused)',
    'taller-otra (Watching for changes)',
  ]);
});

test('Mutagen: sesiones fuera del prefijo taller- se ignoran', () => {
  assert.deepEqual(sesionesMutagenMalas('Name: otra\nStatus: Paused\n'), []);
});

test('Registro: las sesiones dev de MN salen de host + puertos remotos', () => {
  const r = leerRegistroConformidad();
  assert.ok(r.sesionesDev.includes('dev-MN-Inmobiliaria-3110'));
  assert.ok(r.sesionesDev.includes('dev-MN-Inmobiliaria-5199'));
  assert.ok(!r.sesionesDev.includes('dev-MN-Inmobiliaria-3102'), 'el 3102 no es remoto');
  assert.ok(r.hostsPublicos.includes('mn-dev.wandori.us'));
  assert.ok(r.puertosLocalesPublicos.includes(5199));
  assert.ok(r.sitiosRust.some((s) => s.buildMode === 'builder'));
});
