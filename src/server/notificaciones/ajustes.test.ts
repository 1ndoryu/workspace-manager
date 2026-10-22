/* Pruebas del interruptor de la campana (20AA-32). Solo la lectura del valor: la de disco la
 * cubre `campanaActiva` en el arranque y no se puede probar sin tocar el `config/` real. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustesDe } from './ajustes.js';

test('la campana se enciende por defecto, incluso sin ajuste', () => {
  for (const valor of [undefined, null, true, {}, 'no', 0]) {
    assert.deepEqual(ajustesDe(valor), { activa: true, motivo: null }, `«${String(valor)}» no apaga`);
  }
});

test('solo un false explícito la apaga, y dice dónde', () => {
  const r = ajustesDe(false);
  assert.equal(r.activa, false);
  assert.match(r.motivo ?? '', /config\/area\.json/);
});
