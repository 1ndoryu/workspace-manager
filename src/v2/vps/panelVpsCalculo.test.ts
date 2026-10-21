/* Breaker honesto (20AA-24 F2): el aviso de pulse tiene que decir desde cuándo está caído y qué
 * edad tiene el último dato bueno. Antes ponía «agente-abierto» y no había forma de distinguir un
 * corte de tres minutos de uno de ayer. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VpsAgenteRespuesta } from '../../shared/tipos/vps.js';
import { calcularAvisos, edadTexto, textoBreaker } from './panelVpsCalculo.js';

describe('edadTexto', () => {
  it('elige la unidad que se lee de un vistazo', () => {
    assert.equal(edadTexto(5_000), '5 s');
    assert.equal(edadTexto(4 * 60_000), '4 min');
    assert.equal(edadTexto(3 * 3_600_000), '3 h');
    assert.equal(edadTexto(2 * 86_400_000), '2 d');
  });

  it('no inventa edades negativas si el reloj salta', () => {
    assert.equal(edadTexto(-9_000), '0 s');
  });
});

describe('textoBreaker', () => {
  it('callado sin breaker: el aviso normal no cambia', () => {
    assert.equal(textoBreaker(undefined), '');
  });

  it('dice desde cuándo y qué edad tiene lo último bueno', () => {
    assert.equal(
      textoBreaker({ desdeMs: 4 * 60_000, ultimoBuenoMs: 2 * 60_000 }),
      ' · abierto hace 4 min · último dato hace 2 min',
    );
  });

  it('sin dato bueno lo dice, en vez de callar', () => {
    assert.equal(textoBreaker({ desdeMs: 90_000, ultimoBuenoMs: null }), ' · abierto hace 2 min · sin ningún dato bueno');
  });
});

describe('calcularAvisos', () => {
  const conBreaker = (breaker: { desdeMs: number; ultimoBuenoMs: number | null }): VpsAgenteRespuesta => ({
    disponible: false,
    snapshot: null,
    error: 'agente-abierto',
    breaker,
  });

  it('el banner del pulse lleva la edad y el código', () => {
    const { bannerAgente } = calcularAvisos(conBreaker({ desdeMs: 180_000, ultimoBuenoMs: 60_000 }), null);
    assert.equal(bannerAgente, 'pulse-inaccesible: agente-abierto · abierto hace 3 min · último dato hace 1 min');
  });

  it('sin breaker sigue avisando, sólo que sin edad', () => {
    const { bannerAgente } = calcularAvisos({ disponible: false, snapshot: null, error: 'agente-timeout' }, null);
    assert.equal(bannerAgente, 'pulse-inaccesible: agente-timeout');
  });

  it('sin configurar y disponible no avisan', () => {
    assert.equal(calcularAvisos({ disponible: false, snapshot: null, error: 'sin-configurar' }, null).bannerAgente, null);
    assert.equal(calcularAvisos({ disponible: true, snapshot: null, error: null }, null).bannerAgente, null);
  });
});
