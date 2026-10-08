/* Test de /api/vps/pieza (0110A-3 F3): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/vps/rutas/rutasVpsPiezas.test.ts`.
 * Dependencias inyectadas: ningun test toca el binario ni la VPS. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { crearManejadorPiezas, PIEZAS_VALIDAS } from './rutasVpsPiezas.js';

const REQ_VACIA = {} as IncomingMessage;

function fakeRes() {
  const r = { estado: 0, cuerpo: '' as string };
  const res = {
    writeHead: (estado: number) => {
      r.estado = estado;
    },
    end: (cuerpo: string) => {
      r.cuerpo = cuerpo;
    },
  };
  return { r, res };
}

async function llamar(
  manejar: ReturnType<typeof crearManejadorPiezas>,
  params: string,
  ruta = '/api/vps/pieza',
) {
  const { r, res } = fakeRes();
  const url = new URL(`http://localhost${ruta}${params}`);
  const atendida = await manejar(
    REQ_VACIA,
    res as never,
    url,
    ruta,
  );
  return { atendida, estado: r.estado, datos: JSON.parse(r.cuerpo || 'null') as unknown };
}

void describe('/api/vps/pieza', () => {
  void it('ignora otras rutas', async () => {
    const manejar = crearManejadorPiezas();
    const { r, res } = fakeRes();
    const atendida = await manejar(REQ_VACIA, res as never, new URL('http://localhost/api/vps/sitios'), '/api/vps/sitios');
    assert.equal(atendida, false);
    assert.equal(r.estado, 0);
  });

  void it('rechaza pieza desconocida con la lista valida', async () => {
    const manejar = crearManejadorPiezas({ hayBinario: () => true });
    const { atendida, estado, datos } = await llamar(manejar, '?sitio=pulse&pieza=otra');
    assert.equal(atendida, true);
    assert.equal(estado, 400);
    assert.equal((datos as { error: string }).error, 'pieza-invalida');
    assert.deepEqual((datos as { validas: string[] }).validas, PIEZAS_VALIDAS);
  });

  void it('rechaza sitio con nombre invalido (fail-closed)', async () => {
    const manejar = crearManejadorPiezas({ hayBinario: () => true });
    const { estado, datos } = await llamar(manejar, '?sitio=../x&pieza=logs');
    assert.equal(estado, 400);
    assert.equal((datos as { error: string }).error, 'nombre-invalido');
  });

  void it('rechaza objetivo con nombre invalido', async () => {
    const manejar = crearManejadorPiezas({ hayBinario: () => true });
    const { estado, datos } = await llamar(manejar, '?sitio=pulse&pieza=logs&objetivo=a;b');
    assert.equal(estado, 400);
    assert.equal((datos as { error: string }).error, 'objetivo-invalido');
  });

  void it('responde 503 sin binario', async () => {
    const manejar = crearManejadorPiezas({ hayBinario: () => false });
    const { estado, datos } = await llamar(manejar, '?sitio=pulse&pieza=salud');
    assert.equal(estado, 503);
    assert.equal((datos as { error: string }).error, 'sin-binario');
  });

  void it('sirve una pieza y sanea secretos del JSON', async () => {
    const manejar = crearManejadorPiezas({
      hayBinario: () => true,
      corredores: {
        stats: {
          texto: false,
          correr: async () => ({ cpu: 1.5, api_key: 'SECRETO', anidado: { token: 'X' } }),
        },
      },
    });
    const { estado, datos } = await llamar(manejar, '?sitio=pulse&pieza=stats');
    assert.equal(estado, 200);
    const d = datos as { sitio: string; pieza: string; resultado: { ok: boolean; datos: { cpu: number; api_key: string; anidado: { token: string } }; error: null } };
    assert.equal(d.sitio, 'pulse');
    assert.equal(d.pieza, 'stats');
    assert.equal(d.resultado.ok, true);
    assert.equal(d.resultado.datos.cpu, 1.5);
    assert.equal(d.resultado.datos.api_key, '···');
    assert.equal(d.resultado.datos.anidado.token, '···');
  });

  void it('recorta el texto largo y propaga el objetivo a logs', async () => {
    let visto: string | null = 'sin-llamar';
    const manejar = crearManejadorPiezas({
      hayBinario: () => true,
      corredores: {
        logs: {
          texto: true,
          correr: async (_s, o) => {
            visto = o;
            return 'x'.repeat(5000);
          },
        },
      },
    });
    const { estado, datos } = await llamar(manejar, '?sitio=pulse&pieza=logs&objetivo=app-abc123');
    assert.equal(estado, 200);
    assert.equal(visto, 'app-abc123');
    const texto = (datos as { resultado: { datos: string } }).resultado.datos;
    assert.ok(texto.endsWith('…(recortado)'));
  });

  void it('convierte el fallo del corredor en pieza no-ok', async () => {
    const manejar = crearManejadorPiezas({
      hayBinario: () => true,
      corredores: {
        salud: {
          texto: true,
          correr: async () => {
            throw new Error('manager-fallo: timeout');
          },
        },
      },
    });
    const { estado, datos } = await llamar(manejar, '?sitio=pulse&pieza=salud');
    assert.equal(estado, 200);
    const resultado = (datos as { resultado: { ok: boolean; datos: null; error: string } }).resultado;
    assert.equal(resultado.ok, false);
    assert.ok(resultado.error.includes('manager-fallo'));
  });

  void it('responde timeout-pieza si el corredor se cuelga', async () => {
    const manejar = crearManejadorPiezas({
      hayBinario: () => true,
      timeoutMs: 30,
      corredores: {
        eventos: {
          texto: false,
          correr: () => new Promise<unknown>(() => {}),
        },
      },
    });
    const { estado, datos } = await llamar(manejar, '?sitio=pulse&pieza=eventos');
    assert.equal(estado, 200);
    const resultado = (datos as { resultado: { ok: boolean; error: string } }).resultado;
    assert.equal(resultado.ok, false);
    assert.ok(resultado.error.includes('timeout-pieza'));
  });
});
