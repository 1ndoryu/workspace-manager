/* Test del puente TASKS (07AA-5 F2): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/tareas/puente-tareas.test.ts`.
 * Transporte/tiempo inyectados: ningun test toca red ni espera de verdad. */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {crearPuenteTareas, type FetchPuente, type RespuestaPuente} from './puente-tareas.js';
import type {PeticionHttp} from './nucleo/tipos.js';

const CONF = {
  base: 'http://tareas-inventado:4190',
  email: 'a@local.test',
  password: 'x',
  timeoutMs: 1000,
  maxReintentosCuota: 2,
  enfriamientoMs: 60_000,
};

function resp(
  estado: number,
  datos: unknown,
  cookies: string[] = [],
  cab: Record<string, string> = {},
): RespuestaPuente {
  return {
    ok: estado >= 200 && estado < 300,
    estado,
    cabeceras: {obtener: (n) => cab[n.toLowerCase()] ?? null},
    json: () => Promise.resolve(datos),
    cookies,
  };
}

const LOGIN_OK = resp(200, {ok: true}, ['session_id=AAA; Path=/; HttpOnly', 'csrf_token=BBB; Path=/']);
const TAREAS = [{id: 1, item: {titulo: 't'}, updatedAt: 'hoy'}];

interface Llamada {
  url: string;
  init: PeticionHttp;
}

function fakeTransporte(cola: Array<RespuestaPuente | Error>, llamadas: Llamada[]): FetchPuente {
  return async (url, init) => {
    llamadas.push({url, init});
    const r = cola.shift();
    if (r === undefined) throw new Error('guion-agotado');
    if (r instanceof Error) throw r;
    return r;
  };
}

function fakes(cola: Array<RespuestaPuente | Error>) {
  const llamadas: Llamada[] = [];
  const dormidas: number[] = [];
  let t = 1_000_000;
  const puente = crearPuenteTareas({
    config: CONF,
    transporte: fakeTransporte(cola, llamadas),
    dormir: (ms) => {
      dormidas.push(ms);
      return Promise.resolve();
    },
    azar: () => 0.5,
    ahora: () => t,
  });
  return {llamadas, dormidas, puente, avanzar: (ms: number) => { t += ms; }};
}

void describe('puente-tareas', () => {
  void it('login una vez y firma con cookie+csrf (D1)', async () => {
    const {llamadas, puente} = fakes([LOGIN_OK, resp(200, {tareas: TAREAS}), resp(200, {tareas: TAREAS})]);
    const tareas = await puente.listar(9);
    assert.deepEqual(tareas, TAREAS);
    assert.equal(llamadas.length, 2);
    assert.ok(llamadas[0].url.endsWith('/api/auth/login'));
    assert.deepEqual(JSON.parse(String(llamadas[0].init.body)), {email: CONF.email, password: CONF.password});
    const cab = llamadas[1].init.headers as Record<string, string>;
    assert.equal(cab.cookie, 'session_id=AAA; csrf_token=BBB');
    assert.equal(cab['x-csrf-token'], 'BBB');
    const seguidas = await puente.listar(9);
    assert.deepEqual(seguidas, TAREAS);
  });

  void it('ante 401 re-hace login una sola vez aunque caduque en rafaga (lock)', async () => {
    const {llamadas, puente} = fakes([
      LOGIN_OK,
      resp(200, {tareas: TAREAS}),
      resp(401, {error: 'x'}),
      resp(401, {error: 'x'}),
      LOGIN_OK,
      resp(200, {tareas: TAREAS}),
      resp(200, {tareas: TAREAS}),
    ]);
    await puente.listar(9);
    const [a, b] = await Promise.all([puente.listar(9), puente.listar(9)]);
    assert.deepEqual(a, TAREAS);
    assert.deepEqual(b, TAREAS);
    assert.equal(llamadas.filter((l) => l.url.endsWith('/api/auth/login')).length, 2);
  });

  void it('ante 429 espera retry-after con jitter y reintenta (tope)', async () => {
    const {dormidas, puente} = fakes([
      LOGIN_OK,
      resp(429, {error: 'cuota'}, [], {'retry-after': '2'}),
      resp(200, {tareas: TAREAS}),
    ]);
    await puente.listar(9);
    assert.deepEqual(dormidas, [2000]);
  });

  void it('cuota agotada propaga sin reintentar de mas', async () => {
    const f = fakes([LOGIN_OK, resp(429, {}, [], {'retry-after': '1'}), resp(429, {}, [], {'retry-after': '1'}), resp(429, {}, [], {'retry-after': '1'})]);
    await assert.rejects(f.puente.listar(9), (e: unknown) => (e as {codigo: string}).codigo === 'cuota');
    assert.equal(f.dormidas.length, CONF.maxReintentosCuota);
  });

  void it('sin red abre el breaker con motivo y no reintenta en frio', async () => {
    const {llamadas, puente, avanzar} = fakes([new Error('ECONNREFUSED'), new Error('ECONNREFUSED')]);
    await assert.rejects(puente.listar(9), (e: unknown) => (e as {codigo: string}).codigo === 'red');
    const estado = puente.estado();
    assert.equal(estado.disponible, false);
    assert.match(estado.motivo ?? '', /no responde/);
    await assert.rejects(puente.listar(9));
    assert.equal(llamadas.length, 1);
    avanzar(CONF.enfriamientoMs);
    await assert.rejects(puente.listar(9));
    assert.equal(llamadas.length, 2);
  });

  void it('sin credenciales informa motivo sin tocar red', async () => {
    const llamadas: Llamada[] = [];
    const puente = crearPuenteTareas({
      config: {...CONF, email: '', password: ''},
      transporte: fakeTransporte([], llamadas),
    });
    assert.deepEqual(puente.estado(), {
      disponible: false,
      motivo: 'sin-credenciales (TASKS_EMAIL/TASKS_PASSWORD)',
      base: CONF.base,
      conCredenciales: false,
    });
    await assert.rejects(puente.listar(9));
    assert.equal(llamadas.length, 0);
  });
});
