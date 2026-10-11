/* Test de las guardas de escritura del Guardián (F11.4). Se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/guardian/seguridad.test.ts`.
 * Solo cabeceras simuladas: no abre ningún socket. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingHttpHeaders } from 'node:http';
import { verificarPeticionEscritura } from './seguridad.js';

const BUENA: IncomingHttpHeaders = {
  origin: 'http://localhost:5175',
  host: 'localhost:5175',
  'content-type': 'application/json',
};

function con(cambios: Record<string, string | string[]>): IncomingHttpHeaders {
  return { ...BUENA, ...cambios } as IncomingHttpHeaders;
}

describe('verificarPeticionEscritura: aceptadas', () => {
  it('Origin y Host del tablero con JSON', () => {
    assert.deepEqual(verificarPeticionEscritura(BUENA), { ok: true });
  });
  it('127.0.0.1 en el backend y [::1] en el preview, con charset', () => {
    const h = con({
      origin: 'http://127.0.0.1:8787',
      host: '127.0.0.1:8787',
      'content-type': 'Application/JSON; charset=utf-8',
    });
    assert.equal(verificarPeticionEscritura(h).ok, true);
    const p = con({ origin: 'http://[::1]:4173', host: '[::1]:4173' });
    assert.equal(verificarPeticionEscritura(p).ok, true);
  });
});

describe('verificarPeticionEscritura: Origin', () => {
  it('sin Origin → 403', () => {
    const { origin: _omitido, ...sin } = BUENA;
    assert.deepEqual(verificarPeticionEscritura(sin), { ok: false, status: 403, motivo: 'Falta la cabecera Origin' });
  });
  it('Origin como lista (cabecera repetida) → 403', () => {
    const r = verificarPeticionEscritura(con({ origin: ['http://localhost:5175', 'http://localhost:5175'] }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  });
  it('orígenes ajenos o mal formados → 403', () => {
    const malos = [
      'https://localhost:5175', // esquema https no es el del tablero
      'http://evil.com:5175',
      'http://localhost:3000', // puerto no declarado
      'http://localhost:5174', // puerto de opencode-propio: nunca
      'http://localhost', // sin puerto
      'http://localhost:5175/x', // con ruta
      'null', // origen opaco
    ];
    for (const origin of malos) {
      const r = verificarPeticionEscritura(con({ origin }));
      assert.equal(r.ok, false, origin);
      if (!r.ok) assert.equal(r.motivo, 'Origin no permitido', origin);
    }
  });
});

describe('verificarPeticionEscritura: Host (DNS rebinding)', () => {
  it('Host ajeno con Origin correcto → 403', () => {
    const r = verificarPeticionEscritura(con({ host: 'evil.test:8787' }));
    assert.deepEqual(r, { ok: false, status: 403, motivo: 'Host no permitido' });
  });
  it('Host local sin puerto o con puerto no declarado → 403', () => {
    for (const host of ['localhost', 'localhost:3000', 'localhost:5174']) {
      const r = verificarPeticionEscritura(con({ host }));
      assert.equal(r.ok, false, host);
    }
  });
  it('Host sin cabecera → 403', () => {
    const { host: _omitido, ...sin } = BUENA;
    const r = verificarPeticionEscritura(sin);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, 'Host no permitido');
  });
});

describe('verificarPeticionEscritura: Content-Type', () => {
  it('formulario simple (text/plain) → 415', () => {
    const r = verificarPeticionEscritura(con({ 'content-type': 'text/plain' }));
    assert.deepEqual(r, { ok: false, status: 415, motivo: 'Content-Type debe ser application/json' });
  });
  it('sin Content-Type → 415', () => {
    const { 'content-type': _omitido, ...sin } = BUENA;
    const r = verificarPeticionEscritura(sin);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 415);
  });
  it('el origen se comprueba antes que el formato', () => {
    const r = verificarPeticionEscritura(con({ origin: 'http://evil.com:5175', 'content-type': 'text/plain' }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  });
});
