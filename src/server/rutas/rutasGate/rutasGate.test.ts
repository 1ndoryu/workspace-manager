/* Pruebas del despacho de rutas del gate: método incorrecto → 405, ruta ajena → false.
 * [por que] La tabla RUTAS_GATE decide qué se atiende; estas comprobaciones no tocan el
 * snapshot ni Sentinel, así que corren sin VPS y sin escanear el área. Corren en la VPS 89 (AGENTS §8). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { manejarRutasGate } from './rutasGate.js';

function peticion(method: string) {
  const req = Readable.from([]) as unknown as import('node:http').IncomingMessage;
  Object.assign(req, { method });
  return req;
}

function respuestaFalsa() {
  const r = { status: 0, cuerpo: '' };
  const res = {
    writeHead(status: number) { r.status = status; return this; },
    end(texto: string) { r.cuerpo = texto ?? ''; },
  };
  return { res: res as unknown as import('node:http').ServerResponse, r };
}

test('una ruta ajena al gate no la atiende', async () => {
  const { res } = respuestaFalsa();
  const atendida = await manejarRutasGate(peticion('GET'), res, new URL('http://x/api/otra'), '/api/otra');
  assert.equal(atendida, false);
});

test('método incorrecto en una ruta del gate responde 405 y la marca como atendida', async () => {
  const casos = [
    ['/api/gate/reglas', 'POST'],
    ['/api/gate/dinamico', 'POST'],
    ['/api/gate/sincronizacion', 'POST'],
    ['/api/gate/analizar', 'GET'],
    ['/api/gate/analizar-todo', 'GET'],
    ['/api/gate/comparar', 'GET'],
    ['/api/gate/vulnerabilidades-todo', 'GET'],
    ['/api/gate/vulnerabilidades-cache', 'POST'],
  ];
  for (const [ruta, metodo] of casos) {
    const { res, r } = respuestaFalsa();
    const atendida = await manejarRutasGate(peticion(metodo), res, new URL(`http://x${ruta}`), ruta);
    assert.equal(atendida, true, ruta);
    assert.equal(r.status, 405, `${metodo} ${ruta}`);
  }
});

test('dinamico rechaza una herramienta desconocida antes de tocar el runtime', async () => {
  const { res, r } = respuestaFalsa();
  const url = new URL('http://x/api/gate/dinamico?tool=otra');
  const atendida = await manejarRutasGate(peticion('GET'), res, url, '/api/gate/dinamico');
  assert.equal(atendida, true);
  assert.equal(r.status, 400);
});
