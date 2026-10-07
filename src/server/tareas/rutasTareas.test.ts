/* Test de /api/tareas/* (07AA-5 F2): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/tareas/rutasTareas.test.ts`.
 * Puente y lector de body inyectados: ningun test toca TASKS. */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage} from 'node:http';
import {crearManejadorTareas} from './rutasTareas.js';
import type {PuenteTareas} from './puente-tareas.js';
import type {ErrorKanban} from './nucleo/tipos.js';

const REQ_VACIA = {} as IncomingMessage;
const TAREAS = [{id: 1, item: {titulo: 't'}, updatedAt: 'hoy'}];
const LOTE_OK = {movimientos: [{legacyId: 1, orden: 0}]};

function fakeRes() {
  const r = {estado: 0, cuerpo: '', cabeceras: {} as Record<string, string>};
  const res = {
    writeHead: (estado: number) => {
      r.estado = estado;
    },
    setHeader: (k: string, v: string) => {
      r.cabeceras[k] = v;
    },
    end: (cuerpo: string) => {
      r.cuerpo = cuerpo;
    },
  };
  return {r, res};
}

function fakePuente(cambios: Partial<PuenteTareas> & {llamadas?: string[]}): PuenteTareas {
  const llamadas = cambios.llamadas ?? [];
  return {
    estado: () => ({disponible: true, motivo: null, base: 'http://x', conCredenciales: true}),
    listar: async (legacyId) => {
      llamadas.push(`listar:${legacyId}`);
      return TAREAS;
    },
    reordenar: async (lote) => {
      llamadas.push(`reordenar:${lote.movimientos.length}`);
      return TAREAS;
    },
    actualizar: async (legacyId) => {
      llamadas.push(`actualizar:${legacyId}`);
      return TAREAS[0];
    },
    eliminar: async (legacyId) => {
      llamadas.push(`eliminar:${legacyId}`);
    },
    ...cambios,
  };
}

function kanban(codigo: ErrorKanban['codigo'], mensaje: string): ErrorKanban {
  return {codigo, mensaje} as ErrorKanban;
}

async function llamar(manejar: ReturnType<typeof crearManejadorTareas>, ruta: string, metodo: string) {
  const {r, res} = fakeRes();
  const req = {...REQ_VACIA, method: metodo} as IncomingMessage;
  const atendida = await manejar(
    req,
    res as never,
    new URL(`http://localhost${ruta}`),
    ruta.split('?')[0],
  );
  return {atendida, estado: r.estado, datos: JSON.parse(r.cuerpo || 'null') as unknown, cabeceras: r.cabeceras};
}

function manejarCon(puente: PuenteTareas, cuerpo?: unknown, fallaBody = false) {
  return crearManejadorTareas({
    puente,
    leerCuerpo: fallaBody ? async () => { throw new Error('roto'); } : async () => cuerpo,
  });
}

void describe('/api/tareas', () => {
  void it('ignora otras rutas', async () => {
    const manejar = crearManejadorTareas({puente: fakePuente({})});
    const {r, res} = fakeRes();
    const atendida = await manejar(REQ_VACIA, res as never, new URL('http://localhost/api/workspace'), '/api/workspace');
    assert.equal(atendida, false);
    assert.equal(r.estado, 0);
  });

  void it('GET estado expone disponible/motivo', async () => {
    const manejar = manejarCon(fakePuente({}));
    const {atendida, estado, datos} = await llamar(manejar, '/api/tareas/estado', 'GET');
    assert.equal(atendida, true);
    assert.equal(estado, 200);
    assert.equal((datos as {disponible: boolean}).disponible, true);
  });

  void it('GET proyecto rechaza legacy_id ausente o no entero', async () => {
    const llamadas: string[] = [];
    const manejar = manejarCon(fakePuente({llamadas}));
    for (const ruta of ['/api/tareas/proyecto', '/api/tareas/proyecto?legacy_id=abc', '/api/tareas/proyecto?legacy_id=0']) {
      const {estado, datos} = await llamar(manejar, ruta, 'GET');
      assert.equal(estado, 400);
      assert.equal((datos as {error: string}).error, 'legacy_id-invalido');
    }
    assert.equal(llamadas.length, 0);
  });

  void it('GET proyecto devuelve tareas y traduce 404/503', async () => {
    const ok = manejarCon(fakePuente({}));
    const r1 = await llamar(ok, '/api/tareas/proyecto?legacy_id=9', 'GET');
    assert.equal(r1.estado, 200);
    assert.deepEqual((r1.datos as {tareas: unknown}).tareas, TAREAS);

    const no = manejarCon(fakePuente({listar: async () => { throw kanban('no-encontrado', 'Proyecto no encontrado'); }}));
    const r2 = await llamar(no, '/api/tareas/proyecto?legacy_id=9', 'GET');
    assert.equal(r2.estado, 404);

    const caido = manejarCon(fakePuente({listar: async () => { throw kanban('red', 'conexion rechazada'); }}));
    const r3 = await llamar(caido, '/api/tareas/proyecto?legacy_id=9', 'GET');
    assert.equal(r3.estado, 503);
    assert.equal((r3.datos as {error: string}).error, 'tareas-no-disponibles');
  });

  void it('POST reordenar rechaza lote invalido sin tocar TASKS', async () => {
    const llamadas: string[] = [];
    const manejar = manejarCon(fakePuente({llamadas}), {movimientos: []});
    const {estado, datos} = await llamar(manejar, '/api/tareas/reordenar', 'POST');
    assert.equal(estado, 422);
    assert.equal((datos as {error: string}).error, 'lote-invalido');
    assert.equal(llamadas.length, 0);
  });

  void it('POST reordenar acepta lote valido y devuelve actualizadas', async () => {
    const manejar = manejarCon(fakePuente({}), LOTE_OK);
    const {estado, datos} = await llamar(manejar, '/api/tareas/reordenar', 'POST');
    assert.equal(estado, 200);
    assert.deepEqual((datos as {actualizadas: unknown}).actualizadas, TAREAS);
  });

  void it('POST reordenar con body roto responde 400', async () => {
    const manejar = manejarCon(fakePuente({}), undefined, true);
    const {estado, datos} = await llamar(manejar, '/api/tareas/reordenar', 'POST');
    assert.equal(estado, 400);
    assert.equal((datos as {error: string}).error, 'body-invalido');
  });

  void it('POST reordenar traduce cuota a 429 con Retry-After', async () => {
    const manejar = manejarCon(
      fakePuente({reordenar: async () => { throw {codigo: 'cuota', mensaje: 'límite', reintentarEnMs: 2000} as ErrorKanban; }}),
      LOTE_OK,
    );
    const {estado, datos, cabeceras} = await llamar(manejar, '/api/tareas/reordenar', 'POST');
    assert.equal(estado, 429);
    assert.equal(cabeceras['Retry-After'], '2');
    assert.equal((datos as {error: string}).error, 'cuota-tasks');
  });

  void it('PUT tarea actualiza con parche valido y traduce 404/422 (07AA-15)', async () => {
    const llamadas: string[] = [];
    const manejar = manejarCon(fakePuente({llamadas}), {texto: 'nuevo', completado: true});
    const r1 = await llamar(manejar, '/api/tareas/tarea/5', 'PUT');
    assert.equal(r1.estado, 200);
    assert.deepEqual(llamadas, ['actualizar:5']);
    assert.deepEqual((r1.datos as {tarea: unknown}).tarea, TAREAS[0]);

    const malo = manejarCon(fakePuente({llamadas}), {texto: '  '});
    const r2 = await llamar(malo, '/api/tareas/tarea/5', 'PUT');
    assert.equal(r2.estado, 422);
    assert.equal((r2.datos as {error: string}).error, 'parche-invalido');

    const no = manejarCon(fakePuente({actualizar: async () => { throw kanban('no-encontrado', 'Tarea no encontrada'); }}), {texto: 'x'});
    const r3 = await llamar(no, '/api/tareas/tarea/5', 'PUT');
    assert.equal(r3.estado, 404);
    assert.equal((r3.datos as {error: string}).error, 'tarea-no-encontrada');

    const cero = manejarCon(fakePuente({llamadas}), {texto: 'x'});
    const r4 = await llamar(cero, '/api/tareas/tarea/0', 'PUT');
    assert.equal(r4.estado, 400);
  });

  void it('DELETE tarea responde 204 y traduce errores (07AA-15)', async () => {
    const llamadas: string[] = [];
    const manejar = manejarCon(fakePuente({llamadas}));
    const r1 = await llamar(manejar, '/api/tareas/tarea/5', 'DELETE');
    assert.equal(r1.estado, 204);
    assert.deepEqual(llamadas, ['eliminar:5']);

    const no = manejarCon(fakePuente({eliminar: async () => { throw kanban('no-encontrado', 'ya borrada'); }}));
    const r2 = await llamar(no, '/api/tareas/tarea/5', 'DELETE');
    assert.equal(r2.estado, 404);
    assert.equal((r2.datos as {error: string}).error, 'tarea-no-encontrada');
  });
});
