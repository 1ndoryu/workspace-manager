/* Test de /api/recursos/historial (20AA-17): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/recursos/rutasRecursos.test.ts`.
 * Anillo inyectado: ningún test toca el fichero de producción. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { crearManejadorRecursos } from './rutasRecursos.js';
import { crearHistorialRecursos } from './historial.js';
import type { MuestraRecursos } from '../../shared/recursosHistorial.js';

const REQ_VACIA = {} as IncomingMessage;
const T0 = 1_700_000_000_000_000;
const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});
const MUESTRA: MuestraRecursos = [T0, 1, 2, 3, 4, 5, 6, 7, 8];

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
  manejar: ReturnType<typeof crearManejadorRecursos>,
  params: string,
  ruta = '/api/recursos/historial',
) {
  const { r, res } = fakeRes();
  const url = new URL(`http://localhost${ruta}${params}`);
  const atendida = await manejar(REQ_VACIA, res as never, url, ruta);
  return { atendida, estado: r.estado, datos: JSON.parse(r.cuerpo || 'null') as unknown };
}

void describe('/api/recursos/historial', () => {
  void it('ignora otras rutas', async () => {
    const manejar = crearManejadorRecursos();
    const { r, res } = fakeRes();
    const atendida = await manejar(REQ_VACIA, res as never, new URL('http://localhost/api/vps/agente'), '/api/vps/agente');
    assert.equal(atendida, false);
    assert.equal(r.estado, 0);
  });

  void it('rechaza una tab desconocida (fail-closed)', async () => {
    const manejar = crearManejadorRecursos();
    const { atendida, estado, datos } = await llamar(manejar, '?tab=otra');
    assert.equal(atendida, true);
    assert.equal(estado, 400);
    assert.equal((datos as { error: string }).error, 'tab-invalido');
    const sinTab = await llamar(manejar, '');
    assert.equal(sinTab.estado, 400);
  });

  void it('sirve el anillo de la tab pedida', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-recrutas-'));
    temporales.push(dir);
    const historial = crearHistorialRecursos({ ruta: join(dir, 'recursos-historial.json'), ahora: () => T0 });
    historial.anotar('taller', MUESTRA);
    const manejar = crearManejadorRecursos({ historial });
    const vps = await llamar(manejar, '?tab=vps');
    assert.equal(vps.estado, 200);
    assert.deepEqual(vps.datos, { tab: 'vps', muestras: [] });
    const taller = await llamar(manejar, '?tab=taller');
    assert.deepEqual(taller.datos, { tab: 'taller', muestras: [MUESTRA] });
  });
});
