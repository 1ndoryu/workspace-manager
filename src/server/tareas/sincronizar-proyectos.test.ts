/* Test del sync WM->TASKS (08AA-6): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/tareas/sincronizar-proyectos.test.ts`.
 * Dependencias inyectadas: ningun test toca TASKS. */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {generarIdLibre, sincronizarColumnas} from './sincronizar-proyectos.js';

void describe('sincronizar-proyectos', () => {
  void it('empareja por wmClave sin crear nada', async () => {
    let creados = 0;
    const columnas = await sincronizarColumnas({
      wm: [
        {clave: 'gloryapi', nombre: 'gloryapi'},
        {clave: 'PROYECTO TASKS', nombre: 'PROYECTO TASKS'},
      ],
      task: [
        {legacyId: 11, wmClave: 'gloryapi'},
        {legacyId: 12, wmClave: 'PROYECTO TASKS'},
        {legacyId: 9001, wmClave: null},
      ],
      crear: async () => {
        creados += 1;
      },
      ahora: () => 1_700_000_000_000,
    });
    assert.deepEqual(columnas, [
      {clave: 'gloryapi', nombre: 'gloryapi', legacyId: 11},
      {clave: 'PROYECTO TASKS', nombre: 'PROYECTO TASKS', legacyId: 12},
    ]);
    assert.equal(creados, 0);
  });

  void it('crea solo los que faltan, en orden WM y con id espejo-TASKS', async () => {
    const creados: Array<{id: number; nombre: string}> = [];
    const columnas = await sincronizarColumnas({
      wm: [
        {clave: 'a', nombre: 'A'},
        {clave: 'b', nombre: 'B'},
      ],
      task: [{legacyId: 77, wmClave: 'a'}],
      crear: async (id, e) => {
        creados.push({id, nombre: e.nombre});
      },
      ahora: () => 1_700_000_000_000,
    });
    assert.deepEqual(columnas, [
      {clave: 'a', nombre: 'A', legacyId: 77},
      {clave: 'b', nombre: 'B', legacyId: 1_700_000_000_000_000},
    ]);
    assert.deepEqual(creados, [{id: 1_700_000_000_000_000, nombre: 'B'}]);
  });

  void it('ignora entradas WM rotas y duplicados TASKS por clave', async () => {
    const columnas = await sincronizarColumnas({
      wm: [{clave: '', nombre: ''}, {clave: 'a', nombre: 'A'}] as never,
      task: [
        {legacyId: 1, wmClave: 'a'},
        {legacyId: 2, wmClave: 'a'},
      ],
      crear: async () => {
        throw new Error('no-debe-crear');
      },
    });
    assert.deepEqual(columnas, [{clave: 'a', nombre: 'A', legacyId: 1}]);
  });

  void it('generarIdLibre salta ocupados y falla sin hueco', () => {
    assert.equal(generarIdLibre(new Set([5]), 1_700_000_000_000), 1_700_000_000_000_000);
    assert.equal(generarIdLibre(new Set([1_700_000_000_000_000]), 1_700_000_000_000), 1_700_000_000_000_001);
    const llenos = new Set<number>();
    for (let i = 0; i < 1000; i += 1) llenos.add(1_700_000_000_000_000 + i);
    try {
      generarIdLibre(llenos, 1_700_000_000_000);
      assert.fail('debió fallar sin hueco');
    } catch (e) {
      assert.equal((e as {mensaje: string}).mensaje, 'sin-ids-libres para proyecto TASKS');
    }
  });

  void it('propaga el error de crear sin inventar columna', async () => {
    await assert.rejects(
      sincronizarColumnas({
        wm: [{clave: 'a', nombre: 'A'}],
        task: [],
        crear: async () => {
          throw {codigo: 'red', mensaje: 'caido'};
        },
        ahora: () => 1_700_000_000_000,
      }),
      (e: unknown) => (e as {codigo: string}).codigo === 'red',
    );
  });
});
