/* Test de la guardia de entrada (F9.1) y de la auditoría. Se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/seguridad/entrada.test.ts`.
 * El HTTP real usa el puerto 0 y fija la cabecera Host a mano: el servidor solo admite
 * Host de los puertos del tablero, y el puerto efímero no lo cumpliría. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verificarEntrada } from './entrada.js';
import { registrarAuditoria, TAMANO_MAX_AUDITORIA } from './auditoria.js';
import { crearServidor } from '../index.js';

const TOKEN = 'a'.repeat(64);
const BUENA = { host: 'localhost:5175', origin: 'http://localhost:5175', authorization: `Bearer ${TOKEN}` };

describe('verificarEntrada', () => {
  it('admite una petición de la API con token y pestaña del tablero', () => {
    assert.deepEqual(verificarEntrada('/api/workspace', BUENA, TOKEN), { ok: true });
  });

  it('exige token en la API: ausente, mal escrito o de otra longitud → 401', () => {
    assert.equal(verificarEntrada('/api/workspace', { host: BUENA.host }, TOKEN).ok, false);
    assert.equal(verificarEntrada('/api/workspace', { ...BUENA, authorization: `Token ${TOKEN}` }, TOKEN).ok, false);
    assert.equal(verificarEntrada('/api/workspace', { ...BUENA, authorization: `Bearer ${'a'.repeat(63)}` }, TOKEN).ok, false);
    const r = verificarEntrada('/api/workspace', { ...BUENA, authorization: `Bearer ${'b'.repeat(64)}` }, TOKEN);
    assert.deepEqual(r, { ok: false, status: 401, motivo: 'Falta el token de portador o no es válido' });
  });

  it('deja pasar /api/ping sin token y el estático sin token', () => {
    assert.deepEqual(verificarEntrada('/api/ping', { host: BUENA.host }, TOKEN), { ok: true });
    assert.deepEqual(verificarEntrada('/', { host: BUENA.host }, TOKEN), { ok: true });
    assert.deepEqual(verificarEntrada('/assets/app.js', { host: BUENA.host }, TOKEN), { ok: true });
  });

  it('rechaza un Host ajeno (DNS rebinding) aunque lleve token → 403', () => {
    const r = verificarEntrada('/api/workspace', { ...BUENA, host: 'evil.example:8787' }, TOKEN);
    assert.deepEqual(r, { ok: false, status: 403, motivo: 'Host no permitido' });
    assert.equal(verificarEntrada('/', { host: undefined }, TOKEN).ok, false);
  });

  it('rechaza un Origin ajeno aunque lleve token → 403; sin Origin se admite con token', () => {
    const r = verificarEntrada('/api/dev/up', { ...BUENA, origin: 'https://evil.example' }, TOKEN);
    assert.deepEqual(r, { ok: false, status: 403, motivo: 'Origin no permitido' });
    assert.equal(verificarEntrada('/api/dev/up', { ...BUENA, origin: 'http://localhost:5174' }, TOKEN).ok, false);
    const sinOrigin = { host: BUENA.host, authorization: BUENA.authorization };
    assert.deepEqual(verificarEntrada('/api/workspace', sinOrigin, TOKEN), { ok: true });
  });

  it('acepta <nombre>.localhost en los puertos del tablero (dominio del registro)', () => {
    const local = { host: 'workspace.localhost:8787', origin: 'http://workspace.localhost:5175', authorization: `Bearer ${TOKEN}` };
    assert.deepEqual(verificarEntrada('/api/workspace', local, TOKEN), { ok: true });
    assert.equal(verificarEntrada('/api/workspace', { ...local, origin: 'http://workspace.localhost:5174' }, TOKEN).ok, false);
    assert.equal(verificarEntrada('/api/workspace', { ...local, host: 'workspace.localhost' }, TOKEN).ok, false);
  });
});

describe('registrarAuditoria', () => {
  let dir: string;
  before(() => { dir = mkdtempSync(path.join(tmpdir(), 'wm-auditoria-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('añade una línea JSON por petición, sin cabeceras ni token', () => {
    const archivo = path.join(dir, 'a.jsonl');
    registrarAuditoria(archivo, { metodo: 'POST', ruta: '/api/dev/up', estado: 401, origin: null }, new Date('2026-10-14T10:00:00Z'));
    registrarAuditoria(archivo, { metodo: 'GET', ruta: '/api/ping', estado: 200, origin: 'http://localhost:5175' });
    const lineas = readFileSync(archivo, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lineas[0], { t: '2026-10-14T10:00:00.000Z', metodo: 'POST', ruta: '/api/dev/up', estado: 401, origin: null });
    assert.equal(lineas.length, 2);
    assert.ok(!readFileSync(archivo, 'utf8').includes(TOKEN));
  });

  it('rota a .1 al pasar del tamaño máximo', () => {
    const archivo = path.join(dir, 'b.jsonl');
    writeFileSync(archivo, 'x'.repeat(TAMANO_MAX_AUDITORIA + 1));
    registrarAuditoria(archivo, { metodo: 'GET', ruta: '/api/ping', estado: 200, origin: null });
    assert.equal(readFileSync(`${archivo}.1`, 'utf8').length, TAMANO_MAX_AUDITORIA + 1);
    assert.equal(readFileSync(archivo, 'utf8').split('\n').length, 2);
  });
});

describe('servidor HTTP con la guardia activa', () => {
  let servidor: Server;
  let puerto = 0;

  before(async () => {
    servidor = crearServidor({ token: TOKEN, auditoria: null });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    puerto = (servidor.address() as { port: number }).port;
  });
  after(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  function pedir(ruta: string, cabeceras: http.OutgoingHttpHeaders): Promise<number> {
    return new Promise((ok, ko) => {
      const req = http.request({ host: '127.0.0.1', port: puerto, path: ruta, method: 'GET', headers: cabeceras }, (res) => {
        res.resume();
        ok(res.statusCode ?? 0);
      });
      req.on('error', ko);
      req.end();
    });
  }

  it('sin token → 401; con token → pasa la guardia (404 de ruta inexistente)', async () => {
    assert.equal(await pedir('/api/ping', { host: 'localhost:8787' }), 200);
    assert.equal(await pedir('/api/no-existe', { host: 'localhost:8787' }), 401);
    assert.equal(await pedir('/api/no-existe', { host: 'localhost:8787', authorization: `Bearer ${TOKEN}` }), 404);
  });

  it('Origin ajeno con token → 403 antes de enrutar', async () => {
    const estado = await pedir('/api/no-existe', {
      host: 'localhost:8787',
      origin: 'https://evil.example',
      authorization: `Bearer ${TOKEN}`,
    });
    assert.equal(estado, 403);
  });

  /* Misma forma que la pestaña del tablero (Origin y JSON). Ninguna petición borra:
   * se rechaza o responde antes de usar disco o procesos. */
  function pedirMetodo(ruta: string, metodo: string, cabeceras: http.OutgoingHttpHeaders, cuerpo = ''): Promise<number> {
    return new Promise((ok, ko) => {
      const req = http.request(
        { host: '127.0.0.1', port: puerto, path: ruta, method: metodo, headers: { ...cabeceras, 'content-length': Buffer.byteLength(cuerpo) } },
        (res) => {
          res.resume();
          ok(res.statusCode ?? 0);
        },
      );
      req.on('error', ko);
      req.end(cuerpo);
    });
  }
  const TABLERO: http.OutgoingHttpHeaders = {
    host: 'localhost:8787',
    origin: 'http://localhost:8787',
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
  };

  it('limpiar-stream solo acepta POST; el GET que borraba ya no', async () => {
    assert.equal(await pedirMetodo('/api/pc/limpiar-stream?confirmacion=BORRAR', 'GET', TABLERO), 405);
  });

  it('limpiar-stream exige Origin y JSON; sin confirmación no borra', async () => {
    /* Node no admite cabeceras con valor undefined: se quita la clave. */
    const sinOrigin: http.OutgoingHttpHeaders = { ...TABLERO };
    delete sinOrigin.origin;
    assert.equal(await pedirMetodo('/api/pc/limpiar-stream', 'POST', sinOrigin, '{}'), 403);
    assert.equal(await pedirMetodo('/api/pc/limpiar-stream', 'POST', { ...TABLERO, 'content-type': 'text/plain' }, '{}'), 415);
    assert.equal(await pedirMetodo('/api/pc/limpiar-stream', 'POST', TABLERO, '{}'), 400);
  });

  it('las lecturas del tablero rechazan POST con 405', async () => {
    assert.equal(await pedirMetodo('/api/ping', 'POST', { host: 'localhost:8787' }), 405);
    assert.equal(await pedirMetodo('/api/workspace', 'POST', TABLERO), 405);
    assert.equal(await pedirMetodo('/api/proyectos', 'POST', TABLERO), 405);
  });
});
