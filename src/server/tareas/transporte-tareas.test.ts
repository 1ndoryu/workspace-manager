/* Test del transporte nativo TASKS (07AA-5 F3): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/tareas/transporte-tareas.test.ts`.
 * Solo loopback con servidor efimero propio (127.0.0.1:puerto-0): prueba que
 * el transporte de produccion alcanza puertos que el fetch global rechaza
 * (`bad port` en 4190) y separa las `set-cookie` para la sesion D1. */
import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {crearHttpNativo} from './transporte-tareas.js';
import {crearPuenteTareas} from './puente-tareas.js';

let servidor: Server;
let base = '';

before(async () => {
  servidor = createServer((req, res) => {
    if (req.url === '/api/auth/login') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': ['session_id=AAA; Path=/; HttpOnly', 'csrf_token=BBB; Path=/'],
      });
      res.end('{"ok":true}');
      return;
    }
    if (req.url === '/api/projects/7/tasks') {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end('{"tareas":[{"id":1,"item":{"titulo":"t"},"updatedAt":"hoy"}]}');
      return;
    }
    if (req.url === '/lento') {
      setTimeout(() => {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end('{}');
      }, 300);
      return;
    }
    res.writeHead(404, {'content-type': 'application/json'});
    res.end('{"error":"no"}');
  });
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((listo) => servidor.close(() => listo()));
});

void describe('transporte-tareas', () => {
  void it('separa set-cookie y devuelve estado+json', async () => {
    const r = await crearHttpNativo(2000)(`${base}/api/auth/login`, {method: 'POST'});
    assert.equal(r.estado, 200);
    assert.ok(r.ok);
    assert.deepEqual(r.cookies, ['session_id=AAA; Path=/; HttpOnly', 'csrf_token=BBB; Path=/']);
    assert.deepEqual(await r.json(), {ok: true});
  });

  void it('el puente con transporte por defecto lista contra loopback', async () => {
    const puente = crearPuenteTareas({
      config: {
        base,
        email: 'a@local.test',
        password: 'x',
        timeoutMs: 2000,
        maxReintentosCuota: 0,
        enfriamientoMs: 60_000,
      },
    });
    const tareas = await puente.listar(7);
    assert.deepEqual(tareas, [{id: 1, item: {titulo: 't'}, updatedAt: 'hoy'}]);
    assert.deepEqual(puente.estado(), {disponible: true, motivo: null, base, conCredenciales: true});
  });

  void it('timeout aborta y rechaza (red)', async () => {
    await assert.rejects(crearHttpNativo(50)(`${base}/lento`, {}));
  });
});
