/* Tests del canal de eventos (20AA-24 F3): bus puro y entrega SSE real sobre un servidor de
 * verdad. [por que servidor real] Lo que puede romperse aquí no es el reparto —eso son diez
 * líneas— sino el contrato del flujo: `Last-Event-ID`, el nombre de evento y que el canal siga
 * vivo tras un latido. Eso sólo se comprueba con un socket. */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { crearBusEventos, TOPE_HISTORIA } from './bus.js';
import { crearManejadorEventos, temasPedidos } from './rutasEventos.js';
import { huella } from './publicar.js';

describe('bus de eventos', () => {
  it('numera los ids de forma global y recuerda el último de cada tema', () => {
    const bus = crearBusEventos();
    const a = bus.publicar('workspace', { n: 1 });
    const b = bus.publicar('vivos', { n: 2 });
    assert.deepEqual([a.id, b.id], [1, 2]);
    assert.equal(bus.ultimoId(), 2);
    assert.equal(bus.ultimos().workspace?.id, 1);
    assert.equal(bus.ultimos().vivos?.id, 2);
  });

  it('recorta la historia al tope y `desde` devuelve sólo lo posterior', () => {
    const bus = crearBusEventos();
    for (let i = 0; i < TOPE_HISTORIA + 5; i += 1) bus.publicar('workspace', { i });
    const historia = bus.desde(0);
    assert.equal(historia.length, TOPE_HISTORIA);
    assert.equal(historia[0]?.id, 6);
    assert.deepEqual(bus.desde(historia[0]!.id).map((e) => e.id).slice(0, 2), [7, 8]);
  });

  it('la baja deja de entregar y cuenta suscriptores', () => {
    const bus = crearBusEventos();
    const vistos: number[] = [];
    const baja = bus.suscribir('avisos', (e) => vistos.push(e.id));
    assert.equal(bus.suscriptores(), 1);
    bus.publicar('avisos', {});
    baja();
    bus.publicar('avisos', {});
    assert.deepEqual(vistos, [1]);
    assert.equal(bus.suscriptores(), 0);
  });

  it('cada tema sólo llega a sus oyentes', () => {
    const bus = crearBusEventos();
    let vivos = 0;
    let workspace = 0;
    bus.suscribir('vivos', () => (vivos += 1));
    bus.suscribir('workspace', () => (workspace += 1));
    bus.publicar('vivos', {});
    bus.publicar('vivos', {});
    bus.publicar('workspace', {});
    assert.deepEqual([vivos, workspace], [2, 1]);
  });
});

describe('temas pedidos', () => {
  it('sin parámetros pide todos y acepta excluir con =0', () => {
    assert.deepEqual(temasPedidos(new URL('http://x/api/eventos')), ['workspace', 'vivos', 'avisos']);
    assert.deepEqual(temasPedidos(new URL('http://x/api/eventos?vivos=0')), ['workspace', 'avisos']);
  });

  it('si se excluyen todos, devuelve todos: un canal mudo no tiene sentido', () => {
    assert.deepEqual(
      temasPedidos(new URL('http://x/api/eventos?workspace=0&vivos=0&avisos=0')),
      ['workspace', 'vivos', 'avisos'],
    );
  });
});

describe('huella', () => {
  it('distingue cambios y es estable ante el mismo valor', () => {
    assert.equal(huella({ a: 1 }), huella({ a: 1 }));
    assert.notEqual(huella({ a: 1 }), huella({ a: 2 }));
    assert.notEqual(huella([1, 2]), huella([2, 1]));
  });
});

/* --- SSE real ------------------------------------------------------------------------------ */

interface Leido {
  texto: string;
  terminado: Promise<void>;
}

/* Lee el flujo en una ventana fija: el canal no se cierra solo, así que se acumula hasta tener
 * lo que el test busca o hasta que se acaba el tiempo. */
function leerFlujo(url: string, cabeceras: Record<string, string>, ms: number): Promise<Leido> {
  const ctrl = new AbortController();
  let texto = '';
  const terminado = (async () => {
    try {
      const res = await fetch(url, { headers: cabeceras, signal: ctrl.signal });
      const lector = res.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        texto += dec.decode(value, { stream: true });
      }
    } catch {
      /* El corte es el final esperado de la ventana. */
    }
  })();
  setTimeout(() => ctrl.abort(), ms);
  return terminado.then(() => ({ texto, terminado }));
}

describe('GET /api/eventos', () => {
  let servidor: Server;
  let base = '';
  const bus = crearBusEventos();

  before(async () => {
    servidor = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const manejar = crearManejadorEventos(bus);
      void manejar(req, res, url, url.pathname).then((atendido) => {
        if (!atendido) {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  after(async () => {
    bus.detener();
    servidor.closeAllConnections?.();
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  it('solo-ultimos responde la foto sin abrir canal', async () => {
    const res = await fetch(`${base}/api/eventos?solo-ultimos=1`);
    const cuerpo = (await res.json()) as { ultimoId: number; eventos: Record<string, unknown> };
    assert.equal(res.status, 200);
    assert.equal(cuerpo.ultimoId, 0);
    assert.deepEqual(cuerpo.eventos, {});
  });

  it('entrega el nombre del tema como evento y el id para reanudar', async () => {
    const publicado = bus.publicar('avisos', { hola: 'mundo' });
    const { texto } = await leerFlujo(base + '/api/eventos', {}, 120);
    assert.match(texto, /event: avisos/);
    assert.match(texto, new RegExp(`id: ${publicado.id}\\n`));
    assert.match(texto, /"hola":"mundo"/);
  });

  it('con Last-Event-ID sólo manda lo posterior', async () => {
    const primero = bus.publicar('workspace', { viejo: true });
    bus.publicar('workspace', { nuevo: true });
    const { texto } = await leerFlujo(base + '/api/eventos', { 'Last-Event-ID': String(primero.id) }, 120);
    assert.doesNotMatch(texto, /"viejo":true/);
    assert.match(texto, /"nuevo":true/);
  });

  it('un tema excluido no viaja', async () => {
    bus.publicar('vivos', { laptop: [] });
    const { texto } = await leerFlujo(base + '/api/eventos?vivos=0', {}, 120);
    assert.doesNotMatch(texto, /event: vivos/);
  });

  it('un POST se rechaza con 405', async () => {
    const res = await fetch(`${base}/api/eventos`, { method: 'POST' });
    assert.equal(res.status, 405);
  });
});
