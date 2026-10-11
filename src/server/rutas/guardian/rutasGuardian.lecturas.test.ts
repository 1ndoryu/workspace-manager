/* Lecturas (GET) de las rutas del Guardián (10AA-2 F11.4, /api/guardian/*): estado, barrido,
 * plantilla y actividad. Se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/rutas/guardian/rutasGuardian.lecturas.test.ts src/server/rutas/guardian/rutasGuardian.escritura.test.ts`.
 * Fixture compartido en rutasGuardian.fixture.ts. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashDe } from '../../guardian/escritura.js';
import {
  CONFIG_BASE,
  LISTAS_BASE,
  arrancar,
  cerrar,
  pedir,
  proyectos,
  registrar,
  type Respuesta,
} from './rutasGuardian.fixture.js';

/* Fila del barrido de /estado-todo: solo los campos que leen estos tests. */
interface FilaBarrido {
  clave: string;
  elegible: boolean;
  listas?: unknown;
  diferencias?: { estado: string; stacks?: unknown[] };
}

/* Busca un proyecto en el barrido. Si falta, el test falla con su clave y no con un TypeError. */
function filaDe(r: Respuesta, clave: string): FilaBarrido {
  const fila = (r.cuerpo.proyectos as FilaBarrido[]).find((p) => p.clave === clave);
  assert.ok(fila, `falta ${clave} en el barrido`);
  return fila;
}

before(arrancar);
after(cerrar);

describe('lecturas', () => {
  it('un proyecto desconocido responde 404', async () => {
    const r = await pedir('GET', '/api/guardian/estado?clave=no-existe');
    assert.equal(r.status, 404);
  });

  it('una ruta conocida con otro método responde 405 antes que las guardas', async () => {
    const r = await pedir('POST', '/api/guardian/estado', { cabeceras: { Origin: 'http://evil.example' } });
    assert.equal(r.status, 405);
  });

  it('las rutas retiradas (/api/guard/*) ya no las atiende este módulo', async () => {
    const r = await pedir('GET', '/api/guard/estado?clave=sentinel-a');
    assert.equal(r.status, 404);
  });

  it('un proyecto sin puerta sentinel figura como no elegible', async () => {
    registrar('lectura-no-elegible', 'otra', null);
    const r = await pedir('GET', '/api/guardian/estado?clave=lectura-no-elegible');
    assert.equal(r.status, 200);
    assert.deepEqual(r.cuerpo, { clave: 'lectura-no-elegible', elegible: false });
  });

  it('un proyecto elegible devuelve estado y hashes para la siguiente escritura', async () => {
    registrar('lectura-elegible', 'sentinel', CONFIG_BASE);
    const r = await pedir('GET', '/api/guardian/estado?clave=lectura-elegible');
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.elegible, true);
    assert.deepEqual(r.cuerpo.hashes, { config: hashDe(CONFIG_BASE), extra: null });
    assert.deepEqual(r.cuerpo.listas, { estado: 'ok', listas: LISTAS_BASE, modo: 'enforce' });
  });

  it('una política que no valida se devuelve con su motivo, sin listas inventadas', async () => {
    registrar('lectura-invalida', 'sentinel', '{"schemaVersion":1}');
    const r = await pedir('GET', '/api/guardian/estado?clave=lectura-invalida');
    assert.equal(r.status, 200);
    const listas = r.cuerpo.listas as { estado: string; motivo?: unknown };
    assert.equal(listas.estado, 'invalida');
    assert.equal(typeof listas.motivo, 'string');
  });

  it('el barrido del área cuenta todos los proyectos y trae las listas de los elegibles', async () => {
    const r = await pedir('GET', '/api/guardian/estado-todo');
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.total, proyectos.length);
    const elegible = filaDe(r, 'lectura-elegible');
    assert.deepEqual(elegible.listas, { estado: 'ok', listas: LISTAS_BASE, modo: 'enforce' });
    const noElegible = filaDe(r, 'lectura-no-elegible');
    assert.deepEqual(noElegible, { clave: 'lectura-no-elegible', elegible: false });
  });

  it('el barrido trae los comandos sin shim y las diferencias con la plantilla', async () => {
    const r = await pedir('GET', '/api/guardian/estado-todo');
    assert.deepEqual(r.cuerpo.sinShim, ['git', 'python', 'pip']);
    const elegible = filaDe(r, 'lectura-elegible');
    assert.equal(elegible.diferencias?.estado, 'ok');
    assert.deepEqual(elegible.diferencias?.stacks, []);
    const noElegible = filaDe(r, 'lectura-no-elegible');
    assert.equal(noElegible.diferencias, undefined);
  });

  it('las diferencias no se calculan sobre una política inválida', async () => {
    const r = await pedir('GET', '/api/guardian/estado-todo');
    const invalida = filaDe(r, 'lectura-invalida');
    assert.deepEqual(invalida.diferencias, { estado: 'sin-politica' });
  });

  it('la plantilla del tablero se lee válida', async () => {
    const r = await pedir('GET', '/api/guardian/plantilla');
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.estado, 'ok');
  });

  it('una decisión de actividad desconocida es 422', async () => {
    const r = await pedir('GET', '/api/guardian/actividad?decision=nope');
    assert.equal(r.status, 422);
  });
});
