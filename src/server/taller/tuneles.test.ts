/* Pruebas del supervisor de túneles (19AA-15). La decisión (¿reparo o no?) es lo
 * único que importa: el sondeo de puerto y el `up` llegan inyectados, así que
 * aquí no se toca ni la red ni el CLI del taller. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reenviosPortatil, revisarTuneles, tunelesDelRegistro, type EntradaTunel } from './tuneles.js';

const ENTRADAS: EntradaTunel[] = [
  { id: 'proyecto-a', sesiones: ['dev-proyecto-a-4190'], puertosLocales: [14190] },
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

test('tunelesDelRegistro: solo proyectos permanentes, remotos y con reenvíos', () => {
  const salida = tunelesDelRegistro({
    proyectos: [
      { id: 'con-locales', host: 'taller-ejemplo', permanente: true, puertosRemotos: [4190, 4191], puertosLocales: [14190, 14191] },
      { id: 'sin-locales', host: 'taller-ejemplo', supervisar: true, puertosRemotos: [3103, 5176] },
      // Una entrada remota sin la bandera no gana nada: no hay protocolo que la rearme.
      { id: 'remoto-sin-bandera', host: 'taller-ejemplo', puertosRemotos: [3200] },
      // `tunelSsh:false` con `tunelPortatil`: el portátil sí necesita ese reenvío (protocolo 2026-10-21).
      { id: 'expone-sola', host: 'taller-ejemplo', permanente: true, tunelSsh: false, puertosRemotos: [3110], tunelPortatil: [[3110, 3110]] },
      { id: 'sin-tunel-ni-portatil', host: 'taller-ejemplo', permanente: true, puertosRemotos: [3110], tunelSsh: false },
      { id: 'local-permanente', permanente: true, puertos: [5175], tunelPortatil: [[5175, 5175]] },
      { id: 'sin-puertos', host: 'taller-ejemplo', permanente: true },
      { id: 'sin-host', permanente: true, puertosRemotos: [4190] },
    ],
  });
  assert.deepEqual(salida, [
    { id: 'con-locales', sesiones: ['dev-con-locales-4190', 'dev-con-locales-4191'], puertosLocales: [14190, 14191] },
    { id: 'sin-locales', sesiones: ['dev-sin-locales-3103', 'dev-sin-locales-5176'], puertosLocales: [3103, 5176] },
    { id: 'expone-sola', sesiones: ['dev-expone-sola-3110'], puertosLocales: [3110] },
  ]);
});

test('reenviosPortatil: un `tunelesExtra` no es del portátil (tiene otro dueño)', () => {
  // El mismo caso que la ficha de MN: expone sola por Cloudflare, su túnel del portátil lleva
  // 3110 y el 33110 es el puente del gateway, que mantiene el gateway. Si el supervisor lo
  // abriera, dos ssh se pisarían el puerto local y `ExitOnForwardFailure` los haría chocar.
  const mn = {
    host: 'taller-ejemplo',
    modo: 'build',
    tunelSsh: false,
    tunelesExtra: [[33110, 3110]],
    tunelPortatil: [[3110, 3110]],
    build: { puertos: [3110, 20241], puertosLocales: [3110, 20241] },
  };
  assert.deepEqual(reenviosPortatil(mn), [[3110, 3110]]);
  // Un proyecto con túnel del proyecto en dev: sus reenvíos salen de `puertosRemotos`.
  assert.deepEqual(reenviosPortatil({ host: 'x', puertosRemotos: [4190], puertosLocales: [14190] }), [[14190, 4190]]);
  // Sin repetir pares y sin duplicar el del proyecto.
  assert.deepEqual(
    reenviosPortatil({ host: 'x', puertosRemotos: [4190], tunelPortatil: [[4190, 4190], [14200, 4190]] }),
    [[4190, 4190], [14200, 4190]],
  );
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

test('repara si UNO de los puertos locales no escucha (el túnel es uno solo)', async () => {
  const entradas: EntradaTunel[] = [{ id: 'proyecto-d', sesiones: ['dev-proyecto-d-4190'], puertosLocales: [14190, 24190] }];
  const pedidos: string[] = [];
  // El 14190 responde y el 24190 no: sondear solo el primero habría dado el túnel por bueno.
  const probar = (p: number): Promise<boolean> => Promise.resolve(p === 14190);
  const reparados = await revisarTuneles(['dev-proyecto-d-4190'], { entradas, probar, reparar: espia(pedidos), ahora: () => 5_000_000 });
  assert.deepEqual(reparados, ['proyecto-d']);
});

test('enfriamiento: no reintenta el mismo id en la pasada siguiente', async () => {
  const entradas: EntradaTunel[] = [{ id: 'proyecto-b', sesiones: ['dev-proyecto-b-4190'], puertosLocales: [14190] }];
  const pedidos: string[] = [];
  const deps = { entradas, probar: caido, reparar: espia(pedidos), ahora: () => 1_000_000 };
  await revisarTuneles(['dev-proyecto-b-4190'], deps);
  const segunda = await revisarTuneles(['dev-proyecto-b-4190'], deps);
  assert.deepEqual(segunda, [], 'el segundo intento espera al enfriamiento');
  assert.deepEqual(pedidos, ['proyecto-b']);
});

test('un `up` que falla no rompe la revisión ni encadena reintentos', async () => {
  const entradas: EntradaTunel[] = [{ id: 'proyecto-c', sesiones: ['dev-proyecto-c-4190'], puertosLocales: [14190] }];
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

/* La regla de `reenviosPortatil` existe dos veces (aquí y en
 * scripts/dev/doctor/sistema/puertos/modo.mjs) porque el supervisor corre con el módulo cargado por
 * el servidor y ese `.mjs` no se puede importar desde TypeScript sin allowJs. Dos fuentes solo
 * valen si una prueba las compara: esas fichas son el contrato. */
test('reenviosPortatil coincide con paresTunelPortatil del doctor', async () => {
  const { paresTunelPortatil } = await import('../../../scripts/dev/doctor.mjs');
  const fichas = [
    { host: 'x', puertosRemotos: [4190], puertosLocales: [14190] },
    { host: 'x', modo: 'build', tunelSsh: false, tunelesExtra: [[33110, 3110]], tunelPortatil: [[3110, 3110]], build: { puertos: [3110, 20241] } },
    { host: 'x', modo: 'dev', puertos: [5199], build: { puertos: [3110] }, tunelPortatil: [[5199, 5199]] },
    { host: 'x', puertosRemotos: [3103], tunelPortatil: [[14191, 3103], [14192, 3104]] },
  ];
  for (const f of fichas) assert.deepEqual(reenviosPortatil(f), paresTunelPortatil(f), JSON.stringify(f));
});
