/* Puras de la clasificacion de la consola (falsos positivos del tablero).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/clasificacionConsola.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contarProblemas,
  problemasDevDe,
  problemasSentinelDe,
  problemasVulnerabilidadDe,
  type Entrada,
} from './clasificacionConsola.js';
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from './types.js';
import type { InformeDev } from './dev.js';

/* Proyecto minimo: solo los campos que lee la clasificacion. */
const proyecto = { id: 'demo', clave: 'demo' } as unknown as Proyecto;

const entrada = (over: Partial<Entrada>): Entrada => ({
  categoria: 'sentinel',
  motivo: 'x',
  seriedad: 'advertencia',
  ...over,
});

describe('contarProblemas', () => {
  it('cuenta solo las entradas no informativas', () => {
    const entradas = [entrada({}), entrada({ informativa: true }), entrada({ informativa: false })];
    assert.equal(contarProblemas(entradas), 2);
  });

  it('devuelve 0 sin entradas', () => {
    assert.equal(contarProblemas([]), 0);
  });
});

describe('sentinel: severidad', () => {
  const analisis = (severidad: 'error' | 'warning' | 'information' | 'hint'): AnalisisSentinel =>
    ({
      clave: 'demo',
      estado: 'conHallazgos',
      analizadoEn: '2026-10-11T00:00:00.000Z',
      hallazgos: [{ severidad, ruleId: 'R1', mensaje: 'm', archivo: 'a.ts', linea: 1 }],
    }) as unknown as AnalisisSentinel;

  it('hint e information son informativos y no cuentan', () => {
    for (const sev of ['hint', 'information'] as const) {
      const p = problemasSentinelDe(proyecto, analisis(sev));
      assert.ok(p);
      assert.equal(p.entradas[0].informativa, true);
      assert.equal(contarProblemas(p.entradas), 0);
    }
  });

  it('warning cuenta como problema', () => {
    const p = problemasSentinelDe(proyecto, analisis('warning'));
    assert.ok(p);
    assert.equal(p.entradas[0].informativa, undefined);
    assert.equal(contarProblemas(p.entradas), 1);
  });

  it('error cuenta como problema con seriedad error', () => {
    const p = problemasSentinelDe(proyecto, analisis('error'));
    assert.ok(p);
    assert.equal(p.entradas[0].seriedad, 'error');
    assert.equal(contarProblemas(p.entradas), 1);
  });
});

describe('vulnerabilidades: sin parche upstream', () => {
  const vuln = (paquete: string): AnalisisVulnerabilidades =>
    ({
      clave: 'demo',
      gestor: 'cargo',
      estado: 'conHallazgos',
      analizadoEn: '2026-10-11T00:00:00.000Z',
      hallazgos: [{ paquete, severidad: 'high', rango: '<1.0' }],
    }) as unknown as AnalisisVulnerabilidades;

  it('rsa (sin parche) es informativa', () => {
    const p = problemasVulnerabilidadDe(proyecto, vuln('rsa'));
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 0);
  });

  it('un paquete con parche sigue contando', () => {
    const p = problemasVulnerabilidadDe(proyecto, vuln('react-router'));
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 1);
  });
});

describe('dev: bajo mando', () => {
  const informe = (estado: 'bajo-mando' | 'deriva'): InformeDev =>
    ({
      proyectos: [{ clave: 'demo', id: 'demo-dev', estado, motivo: 'm' }],
      huerfanos: [],
      errorSensor: null,
    }) as unknown as InformeDev;

  it('bajo mando es informativo y no cuenta', () => {
    const p = problemasDevDe(proyecto, informe('bajo-mando'), null);
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 0);
  });

  it('deriva sigue contando como problema', () => {
    const p = problemasDevDe(proyecto, informe('deriva'), null);
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 1);
  });
});
