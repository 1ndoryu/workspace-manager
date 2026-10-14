/* Escrituras (POST) de las rutas del Guardián (10AA-2 F11.4, /api/guardian/*): guardas de
 * origen, topes, política, lote, probar y mantenimiento. Se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/rutas/guardian/rutasGuardian.lecturas.test.ts src/server/rutas/guardian/rutasGuardian.escritura.test.ts`.
 * Fixture compartido en rutasGuardian.fixture.ts. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashDe } from '../../guardian/escritura.js';
import { CONFIG_BASE, arrancar, cerrar, leer, llamadas, pedir, registrar } from './rutasGuardian.fixture.js';

before(arrancar);
after(cerrar);

describe('guardas de escritura', () => {
  it('un Origin ajeno responde 403 sin escribir', async () => {
    const r = await pedir('POST', '/api/guardian/topes', {
      cabeceras: { Origin: 'http://evil.example' },
      cuerpo: { clave: 'lectura-elegible', hashes: {}, cambio: {} },
    });
    assert.equal(r.status, 403);
  });

  it('un Host ajeno responde 403', async () => {
    const r = await pedir('POST', '/api/guardian/topes', {
      cabeceras: { Host: 'evil.example' },
      cuerpo: { clave: 'lectura-elegible', hashes: {}, cambio: {} },
    });
    assert.equal(r.status, 403);
  });

  it('un Content-Type que no es JSON responde 415', async () => {
    const r = await pedir('POST', '/api/guardian/topes', {
      cabeceras: { 'Content-Type': 'text/plain' },
      crudo: '{}',
    });
    assert.equal(r.status, 415);
  });

  it('un cuerpo que no es JSON responde 400', async () => {
    const r = await pedir('POST', '/api/guardian/topes', { crudo: '{no json' });
    assert.equal(r.status, 400);
  });
});

describe('topes', () => {
  it('la vista previa calcula el diff sin escribir', async () => {
    const ruta = registrar('topes-vista', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: { clave: 'topes-vista', hashes: { config: hashDe(CONFIG_BASE), extra: null }, cambio: { modo: 'observe' } },
    });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.escrito, false);
    assert.equal(r.cuerpo.cambia, true);
    assert.notEqual(r.cuerpo.diffConfig, null);
    assert.equal(leer(ruta, 'sentinel.config.json'), CONFIG_BASE);
  });

  it('confirmar escribe el modo de topes y devuelve los hashes nuevos', async () => {
    const ruta = registrar('topes-escribe', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: {
        clave: 'topes-escribe',
        hashes: { config: hashDe(CONFIG_BASE), extra: null },
        cambio: { modo: 'observe' },
        confirmar: true,
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.escrito, true);
    assert.equal(JSON.parse(leer(ruta, 'sentinel.config.json')).budgets.mode, 'observe');
    assert.equal((r.cuerpo.hashes as { config: string }).config, hashDe(leer(ruta, 'sentinel.config.json')));
  });

  it('un hash previo distinto responde 409 y no escribe', async () => {
    const ruta = registrar('topes-conflicto', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: { clave: 'topes-conflicto', hashes: { config: 'deadbeef', extra: null }, cambio: { modo: 'observe' }, confirmar: true },
    });
    assert.equal(r.status, 409);
    assert.equal(leer(ruta, 'sentinel.config.json'), CONFIG_BASE);
  });

  it('un modo fuera de la lista responde 422', async () => {
    registrar('topes-modo-malo', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: { clave: 'topes-modo-malo', hashes: { config: hashDe(CONFIG_BASE), extra: null }, cambio: { modo: 'pass' } },
    });
    assert.equal(r.status, 422);
  });

  it('un extra fuera de rango responde 422', async () => {
    registrar('topes-extra-malo', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: { clave: 'topes-extra-malo', hashes: { config: hashDe(CONFIG_BASE), extra: null }, cambio: { extraTotal: 500 } },
    });
    assert.equal(r.status, 422);
  });

  it('confirmar un extra crea lote-extra.md con el total en la primera línea', async () => {
    const ruta = registrar('topes-extra', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: {
        clave: 'topes-extra',
        hashes: { config: hashDe(CONFIG_BASE), extra: null },
        cambio: { extraTotal: 2, motivo: 'lote de prueba' },
        confirmar: true,
      },
    });
    assert.equal(r.status, 200);
    assert.match(leer(ruta, 'lote-extra.md'), /^\+2 lote de prueba/u);
  });
});

describe('política', () => {
  it('la vista previa no escribe', async () => {
    const ruta = registrar('politica-vista', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/politica', {
      cuerpo: { clave: 'politica-vista', hashPrevio: hashDe(CONFIG_BASE), cambio: { modo: 'observe' } },
    });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.escrito, false);
    assert.equal(leer(ruta, 'sentinel.config.json'), CONFIG_BASE);
  });

  it('un proyecto sin puerta sentinel responde 422', async () => {
    registrar('politica-no-elegible', 'otra', null);
    const r = await pedir('POST', '/api/guardian/politica', {
      cuerpo: { clave: 'politica-no-elegible', hashPrevio: 'x', cambio: {} },
    });
    assert.equal(r.status, 422);
  });
});

describe('lote', () => {
  it('una clave repetida responde 422', async () => {
    registrar('lote-repetido', 'sentinel', CONFIG_BASE);
    const entrada = { clave: 'lote-repetido', hashPrevio: hashDe(CONFIG_BASE), cambio: { modo: 'observe' } };
    const r = await pedir('POST', '/api/guardian/lote', { cuerpo: { entradas: [entrada, entrada] } });
    assert.equal(r.status, 422);
  });

  it('un lote vacío responde 422', async () => {
    const r = await pedir('POST', '/api/guardian/lote', { cuerpo: { entradas: [] } });
    assert.equal(r.status, 422);
  });

  it('la vista previa de dos proyectos devuelve un resultado por clave sin escribir', async () => {
    const ruta1 = registrar('lote-a', 'sentinel', CONFIG_BASE);
    const ruta2 = registrar('lote-b', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/lote', {
      cuerpo: {
        entradas: [
          { clave: 'lote-a', hashPrevio: hashDe(CONFIG_BASE), cambio: { modo: 'observe' } },
          { clave: 'lote-b', hashPrevio: hashDe(CONFIG_BASE), cambio: { modo: 'observe' } },
        ],
      },
    });
    assert.equal(r.status, 200);
    assert.equal((r.cuerpo.resultados as unknown[]).length, 2);
    assert.equal(r.cuerpo.escrito, false);
    assert.equal(leer(ruta1, 'sentinel.config.json'), CONFIG_BASE);
    assert.equal(leer(ruta2, 'sentinel.config.json'), CONFIG_BASE);
  });
});

describe('probar y mantenimiento', () => {
  it('probar usa la raíz del proyecto, no la que envía el cliente', async () => {
    const ruta = registrar('probar-a', 'sentinel', CONFIG_BASE);
    const antes = llamadas.probar.length;
    const r = await pedir('POST', '/api/guardian/probar', {
      cuerpo: { clave: 'probar-a', ejecutable: 'npm', args: ['run', 'lint'], raiz: 'C:/otro' },
    });
    assert.equal(r.status, 200);
    assert.equal((r.cuerpo.decision as { blocked: boolean }).blocked, true);
    assert.equal(llamadas.probar.length, antes + 1);
    assert.deepEqual(llamadas.probar[antes], { raiz: ruta, ejecutable: 'npm', args: ['run', 'lint'] });
  });

  it('probar con args que no son una lista responde 422', async () => {
    registrar('probar-args', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/probar', {
      cuerpo: { clave: 'probar-args', ejecutable: 'npm', args: 'run lint' },
    });
    assert.equal(r.status, 422);
  });

  it('probar con un ejecutable fuera del registro responde 422 sin llamar a Sentinel', async () => {
    registrar('probar-fuera', 'sentinel', CONFIG_BASE);
    const antes = llamadas.probar.length;
    const r = await pedir('POST', '/api/guardian/probar', {
      cuerpo: { clave: 'probar-fuera', ejecutable: 'curl', args: ['https://example.com'] },
    });
    assert.equal(r.status, 422);
    assert.equal(llamadas.probar.length, antes);
  });

  it('probar en un proyecto sin política del Guardián responde 422 sin llamar a Sentinel', async () => {
    registrar('probar-sin-politica', 'sentinel', null);
    const antes = llamadas.probar.length;
    const r = await pedir('POST', '/api/guardian/probar', {
      cuerpo: { clave: 'probar-sin-politica', ejecutable: 'npm', args: ['run', 'lint'] },
    });
    assert.equal(r.status, 422);
    assert.equal(llamadas.probar.length, antes);
  });

  it('mantenimiento no reenvía rutas del cliente, solo sus tres banderas', async () => {
    const antes = llamadas.mantenimiento.length;
    const r = await pedir('POST', '/api/guardian/mantenimiento', {
      cuerpo: { sourceRoot: 'C:/evil', targetRoot: 'C:/evil', conShims: true, confirmar: false },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(llamadas.mantenimiento[antes], { conShims: true, confirmar: false });
  });

  it('mantenimiento con una bandera que no es booleana responde 422', async () => {
    const r = await pedir('POST', '/api/guardian/mantenimiento', { cuerpo: { conShims: 'si' } });
    assert.equal(r.status, 422);
  });
});
