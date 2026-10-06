/* Test del anillo por sitio (0110A-3 F2): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/v2/vps/historialSitios.test.ts`.
 * Puro (sin DOM): el localStorage real se evita inyectando nada —las
 * funciones de storage fallan suave sin window, así que aquí solo se
 * prueban sumar/muestrear/serie (cargar/guardar ya los cubre el panel
 * global con el mismo pacto). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERVALO_SITIO_MS,
  MAX_MUESTRAS_SITIO,
  MAX_PUNTOS_CHISPA,
  muestrearSitios,
  serieEnRango,
  sumarPorSitio,
} from './historialSitios.js';

void describe('historial por sitio', () => {
  void it('suma cpu/mem por clave y redondea', () => {
    const m = sumarPorSitio([
      { clave: 'sitio:a', cpu: 1.05, mem: 100.4 },
      { clave: 'sitio:a', cpu: 2.05, mem: 50.4 },
      { clave: 'infra', cpu: 0.5, mem: 10 },
    ]);
    assert.deepEqual(m.get('sitio:a'), { cpu: 3.1, mem: 151 });
    assert.deepEqual(m.get('infra'), { cpu: 0.5, mem: 10 });
  });

  void it('muestrea cada 30 s y no mezcla sitios', () => {
    const sumas = new Map([['sitio:a', { cpu: 3, mem: 150 }]]);
    const r1 = muestrearSitios({}, sumas, 0);
    assert.equal(r1.cambio, true);
    assert.equal(r1.siguiente['sitio:a']?.length, 1);
    const r2 = muestrearSitios(r1.siguiente, sumas, INTERVALO_SITIO_MS - 1);
    assert.equal(r2.cambio, false); // muy pronto: sin muestra
    const r3 = muestrearSitios(r1.siguiente, sumas, INTERVALO_SITIO_MS);
    assert.equal(r3.cambio, true);
    assert.equal(r3.siguiente['sitio:a']?.length, 2);
  });

  void it('recorta al tope sin perder la última', () => {
    const viejas: [number, number, number][] = [];
    for (let i = 0; i < MAX_MUESTRAS_SITIO; i += 1) viejas.push([i * INTERVALO_SITIO_MS, 1, 1]);
    const sumas = new Map([['sitio:a', { cpu: 9, mem: 9 }]]);
    const r = muestrearSitios({ 'sitio:a': viejas }, sumas, MAX_MUESTRAS_SITIO * INTERVALO_SITIO_MS);
    assert.equal(r.siguiente['sitio:a']?.length, MAX_MUESTRAS_SITIO);
    assert.deepEqual(r.siguiente['sitio:a']?.[MAX_MUESTRAS_SITIO - 1]?.slice(1), [9, 9]);
  });

  void it('la serie en rango filtra y diezma con última incluida', () => {
    const ahora = 1_000_000;
    const muchas: [number, number, number][] = [];
    for (let i = 0; i < MAX_PUNTOS_CHISPA * 3; i += 1) muchas.push([ahora - i * 1000, i, i]);
    const serie = serieEnRango(muchas, 3600 * 1000, ahora);
    assert.ok(serie.length <= MAX_PUNTOS_CHISPA + 1);
    assert.equal(serie[serie.length - 1]?.[0], muchas[muchas.length - 1]?.[0]);
    const corta = serieEnRango(muchas.slice(0, 5), 60 * 1000, ahora);
    assert.equal(corta.length, 5); // sin diezmar si cabe
  });
});
