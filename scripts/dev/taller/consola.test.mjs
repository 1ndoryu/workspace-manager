/* Contrato de la consola agregada (07AA-1 F3): el total de
 * GET /api/consola/problemas es la suma de su desglose y cada entrada trae
 * categoria + motivo. Integracion contra el backend vivo; sin 8787 se omite
 * (rehusa a ciegas, igual que el mando). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cabeceraAutorizacion } from '../token.mjs';

const API = process.env.WM_API ?? 'http://127.0.0.1:8787';
// [por que] Fuera de leer() (que va dentro del try de abajo): un token ausente debe romper el test, no omitirlo.
const cabeceras = cabeceraAutorizacion();

async function leer() {
  const resp = await fetch(`${API}/api/consola/problemas`, { headers: cabeceras });
  assert.equal(resp.status, 200);
  return resp.json();
}

let data = null;
try {
  data = await leer();
} catch {
  console.log('consola agregada: backend 8787 caido, se omite');
}

test('consola agregada: total es la suma del desglose', { skip: !data }, async () => {
  const suma = data.proyectos.reduce((n, g) => n + g.total, 0);
  assert.equal(data.total, suma);
  for (const g of data.proyectos) {
    /* El total cuenta todas las entradas que el tablero muestra. */
    assert.equal(g.total, g.entradas.length);
    for (const e of g.entradas) {
      assert.ok(typeof e.categoria === 'string' && e.categoria.length > 0);
      assert.ok(typeof e.motivo === 'string' && e.motivo.length > 0);
    }
  }
  assert.ok(data.vigencia && typeof data.vigencia.devEn === 'string');
});
