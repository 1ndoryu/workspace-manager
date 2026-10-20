import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {crearCacheProyectos} from './cacheProyectosTasks.js';
import type {ProyectoPuente} from '../tarea-unitaria.js';

/* Pedidor falso: cuenta las llamadas y resuelve con lo que se le pida después. */
function pedidorFalso(valores: ProyectoPuente[][]) {
  let llamadas = 0;
  const pedir = async () => {
    llamadas++;
    return valores[Math.min(llamadas - 1, valores.length - 1)];
  };
  return {pedir, llamadas: () => llamadas};
}

const A = [{legacyId: 1}] as unknown as ProyectoPuente[];
const B = [{legacyId: 2}] as unknown as ProyectoPuente[];

describe('crearCacheProyectos', () => {
  it('sirve de caché dentro del TTL y vuelve al servicio al caducar', async () => {
    let reloj = 0;
    const f = pedidorFalso([A, B]);
    const cache = crearCacheProyectos(f.pedir, 1000, () => reloj);
    assert.deepEqual(await cache.obtener(), A);
    reloj = 999;
    assert.deepEqual(await cache.obtener(), A);
    assert.equal(f.llamadas(), 1);
    reloj = 1000;
    assert.deepEqual(await cache.obtener(), B);
    assert.equal(f.llamadas(), 2);
  });

  it('las llamadas simultáneas comparten un solo vuelo', async () => {
    const f = pedidorFalso([A]);
    const cache = crearCacheProyectos(f.pedir, 1000);
    const [x, y] = await Promise.all([cache.obtener(), cache.obtener()]);
    assert.equal(x, y);
    assert.equal(f.llamadas(), 1);
  });

  it('un fallo no se cachea: la siguiente lectura vuelve a pedir', async () => {
    let intentos = 0;
    const cache = crearCacheProyectos(async () => {
      intentos++;
      if (intentos === 1) throw new Error('red');
      return A;
    }, 1000);
    await assert.rejects(cache.obtener(), /red/);
    assert.deepEqual(await cache.obtener(), A);
    assert.equal(intentos, 2);
  });

  it('invalidar fuerza una nueva lectura en la siguiente llamada', async () => {
    const f = pedidorFalso([A, B]);
    const cache = crearCacheProyectos(f.pedir, 60_000);
    await cache.obtener();
    cache.invalidar();
    assert.deepEqual(await cache.obtener(), B);
    assert.equal(f.llamadas(), 2);
  });

  it('un vuelo que termina tras invalidar no deja datos anteriores como buenos', async () => {
    let soltar: (v: ProyectoPuente[]) => void = () => {};
    let llamadas = 0;
    const cache = crearCacheProyectos(() => {
      llamadas++;
      if (llamadas === 1) return new Promise<ProyectoPuente[]>((r) => (soltar = r));
      return Promise.resolve(B);
    }, 60_000);
    const enCurso = cache.obtener();
    cache.invalidar();
    soltar(A); /* llega el dato viejo, después de la invalidación */
    assert.deepEqual(await enCurso, A);
    assert.deepEqual(await cache.obtener(), B); /* no se sirve A desde caché */
    assert.equal(llamadas, 2);
  });
});
