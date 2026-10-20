/* Pruebas del supervisor de túneles (19AA-15). La decisión (¿reparo o no?) es lo
 * único que importa: el sondeo de puerto y el `up` llegan inyectados, así que
 * aquí no se toca ni la red ni el CLI del taller. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisarTuneles, tunelesDelRegistro, type EntradaTunel } from './tuneles.js';

const ENTRADAS: EntradaTunel[] = [
  { id: 'proyecto-a', sesiones: ['dev-proyecto-a-4190'], puertoLocal: 14190 },
];

/* `reparar` que anota lo que se le pide, para contar intentos. */
function espia(registro: string[], falla = false) {
  return (id: string): Promise<{ codigo: number; salida: string }> => {
    registro.push(id);
    if (falla) return Promise.reject(new Error('el CLI rehusó'));
    return Promise.resolve({ codigo: 0, salida: 'arrancado' });
  };
}

const caido = (): Promise<boolean> => Promise.resolve(false);
const vivo = (): Promise<boolean> => Promise.resolve(true);

test('tunelesDelRegistro: solo proyectos con host, túnel y puertos', () => {
  const salida = tunelesDelRegistro({
    proyectos: [
      { id: 'con-locales', host: 'dev89', puertosRemotos: [4190, 4191], puertosLocales: [14190, 14191] },
      { id: 'sin-locales', host: 'dev89', puertosRemotos: [3103, 5176] },
      { id: 'sin-tunel', host: 'dev89', puertosRemotos: [3110], tunelSsh: false },
      { id: 'local', puertos: [5175] },
      { id: 'sin-puertos', host: 'dev89' },
      { id: 'sin-host', puertosRemotos: [4190] },
    ],
  });
  assert.deepEqual(salida, [
    {
      id: 'con-locales',
      sesiones: ['dev-con-locales-4190', 'dev-con-locales-4191'],
      puertoLocal: 14190,
    },
    { id: 'sin-locales', sesiones: ['dev-sin-locales-3103', 'dev-sin-locales-5176'], puertoLocal: 3103 },
  ]);
});

test('repara el túnel de un proyecto que la 89 tiene en marcha y no escucha', async () => {
  const pedidos: string[] = [];
  const reparados = await revisarTuneles(['dev-proyecto-a-4190'], {
    entradas: ENTRADAS,
    probar: caido,
    reparar: espia(pedidos),
  });
  assert.deepEqual(reparados, ['proyecto-a']);
  assert.deepEqual(pedidos, ['proyecto-a']);
});

test('no toca el túnel que ya escucha', async () => {
  const pedidos: string[] = [];
  const reparados = await revisarTuneles(['dev-proyecto-a-4190'], {
    entradas: ENTRADAS,
    probar: vivo,
    reparar: espia(pedidos),
  });
  assert.deepEqual(reparados, []);
  assert.deepEqual(pedidos, []);
});

test('no resucita un proyecto parado a propósito (sin sesión tmux en la 89)', async () => {
  const pedidos: string[] = [];
  const reparados = await revisarTuneles([], { entradas: ENTRADAS, probar: caido, reparar: espia(pedidos) });
  assert.deepEqual(reparados, []);
  assert.deepEqual(pedidos, []);
});

test('enfriamiento: no reintenta el mismo id en la pasada siguiente', async () => {
  const entradas: EntradaTunel[] = [{ id: 'proyecto-b', sesiones: ['dev-proyecto-b-4190'], puertoLocal: 14190 }];
  const pedidos: string[] = [];
  const deps = { entradas, probar: caido, reparar: espia(pedidos), ahora: () => 1_000_000 };
  await revisarTuneles(['dev-proyecto-b-4190'], deps);
  const segunda = await revisarTuneles(['dev-proyecto-b-4190'], deps);
  assert.deepEqual(segunda, [], 'el segundo intento espera al enfriamiento');
  assert.deepEqual(pedidos, ['proyecto-b']);
});

test('un `up` que falla no rompe la revisión ni encadena reintentos', async () => {
  const entradas: EntradaTunel[] = [{ id: 'proyecto-c', sesiones: ['dev-proyecto-c-4190'], puertoLocal: 14190 }];
  const pedidos: string[] = [];
  const deps = {
    entradas,
    probar: caido,
    reparar: espia(pedidos, true),
    ahora: () => 2_000_000,
  };
  assert.deepEqual(await revisarTuneles(['dev-proyecto-c-4190'], deps), ['proyecto-c']);
  /* El rechazo se traga (la revisión no es quien decide si el arranque salió
   * bien: eso lo dice el estado del taller en la pasada siguiente). */
  await Promise.resolve();
  assert.deepEqual(await revisarTuneles(['dev-proyecto-c-4190'], deps), []);
  assert.deepEqual(pedidos, ['proyecto-c']);
});
