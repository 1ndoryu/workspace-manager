/* `aplicarVivos` (20AA-24 F3.2): la regla que impide que el mapa mienta. `null` es «no se pudo
 * preguntar», no «no hay nada vivo»: con dos VPS, confundirlos apagaría los nodos de una porque la
 * otra no contestó. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crearStoreVivos } from './accionesVivos.js';

describe('aplicarVivos', () => {
  it('guarda cada fuente por separado', () => {
    const store = crearStoreVivos();
    store.getState().aplicarVivos(['a'], ['sitio-1']);
    assert.deepEqual([...(store.getState().vivosLaptop ?? [])], ['a']);
    assert.deepEqual([...(store.getState().vivosProduccion ?? [])], ['sitio-1']);
  });

  it('una fuente que no contesta conserva lo último bueno de ESA fuente', () => {
    const store = crearStoreVivos();
    store.getState().aplicarVivos(['a'], ['sitio-1']);
    store.getState().aplicarVivos(null, []);
    assert.deepEqual([...(store.getState().vivosLaptop ?? [])], ['a']);
    assert.equal(store.getState().vivosProduccion?.size, 0);
  });

  it('sin datos nuevos todavía, no afirma nada', () => {
    const store = crearStoreVivos();
    store.getState().aplicarVivos(null, null);
    assert.deepEqual([store.getState().vivosLaptop, store.getState().vivosProduccion], [null, null]);
  });

  it('un evento idéntico no reemplaza el conjunto (ni repinta el mapa)', () => {
    const store = crearStoreVivos();
    store.getState().aplicarVivos(['a', 'b'], null);
    const antes = store.getState().vivosLaptop;
    store.getState().aplicarVivos(['b', 'a'], null);
    assert.equal(store.getState().vivosLaptop, antes);
  });
});
