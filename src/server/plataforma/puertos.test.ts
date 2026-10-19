/* Puertos del tablero: valores por defecto y su override por entorno.
 * [por qué se reimporta con `?v=`] El módulo lee `process.env` al importarse (una
 * sola vez por instancia), así que un override no se puede simular sobre el
 * import estático. Una URL distinta es una instancia nueva: es la forma de
 * comprobar de verdad el contrato sin arrancar un proceso aparte. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PUERTO_API, PUERTO_AJENO, PUERTO_PREVIEW, PUERTO_WEB, PUERTOS_PROTEGIDOS, PUERTOS_TABLERO } from './puertos.js';

type Puertos = typeof import('./puertos.js');

async function conEntorno(vars: Record<string, string>, marca: string): Promise<Puertos> {
  const previo: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previo[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return (await import(`./puertos.js?${marca}`)) as Puertos;
  } finally {
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('los puertos por defecto son los del tablero', () => {
  assert.equal(PUERTO_API, 8787);
  assert.equal(PUERTO_WEB, 5175);
  assert.equal(PUERTO_PREVIEW, 4173);
  assert.equal(PUERTO_AJENO, 5174);
});

test('el tablero protege sus tres puertos y el de opencode', () => {
  assert.deepEqual([...PUERTOS_TABLERO], [PUERTO_WEB, PUERTO_API, PUERTO_PREVIEW]);
  assert.deepEqual(
    [...PUERTOS_PROTEGIDOS].sort((a, b) => a - b),
    [PUERTO_AJENO, PUERTO_WEB, PUERTO_API].sort((a, b) => a - b),
  );
});

test('WS_* mueve cada puerto sin tocar el código', async () => {
  const p = await conEntorno({ WS_PORT: '9999', WS_WEB_PORT: '9998' }, 'movido');
  assert.equal(p.PUERTO_API, 9999);
  assert.equal(p.PUERTO_WEB, 9998);
  assert.equal(p.PUERTO_PREVIEW, 4173, 'lo que no se declara se queda en su defecto');
});

test('un valor ilegal no rompe: se queda el defecto', async () => {
  for (const [marca, valor] of [['texto', 'no-es-un-puerto'], ['cero', '0'], ['enorme', '70000']] as const) {
    const p = await conEntorno({ WS_PORT: valor }, `ilegal-${marca}`);
    assert.equal(p.PUERTO_API, 8787, `WS_PORT=${valor}`);
  }
});
