/* Puras de la clasificacion de la consola (falsos positivos del tablero).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/clasificacionConsola.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contarProblemas,
  problemaHuerfanosSinProyecto,
  problemasDevDe,
  problemasSentinelDe,
  problemasVulnerabilidadDe,
  type Entrada,
} from './clasificacionConsola.js';
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from '../types.js';
import type { HuerfanoDev } from '../dev.js';
import type { InformeDev } from '../dev.js';

/* Proyecto minimo: solo los campos que lee la clasificacion. */
const proyecto = { id: 'demo', clave: 'demo' } as unknown as Proyecto;

const entrada = (over: Partial<Entrada>): Entrada => ({
  categoria: 'sentinel',
  motivo: 'x',
  seriedad: 'advertencia',
  ...over,
});

describe('contarProblemas', () => {
  it('cuenta todas las entradas mostradas, tengan o no seriedad', () => {
    const entradas = [entrada({}), entrada({ seriedad: null }), entrada({ seriedad: 'error' })];
    assert.equal(contarProblemas(entradas), 3);
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

  it('hint e information se muestran sin seriedad y cuentan', () => {
    for (const sev of ['hint', 'information'] as const) {
      const p = problemasSentinelDe(proyecto, analisis(sev));
      assert.ok(p);
      assert.equal(p.entradas[0].seriedad, null);
      assert.equal(contarProblemas(p.entradas), 1);
    }
  });

  it('warning cuenta como problema', () => {
    const p = problemasSentinelDe(proyecto, analisis('warning'));
    assert.ok(p);
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

  it('rsa (sin parche) se muestra sin seriedad y cuenta', () => {
    const p = problemasVulnerabilidadDe(proyecto, vuln('rsa'));
    assert.ok(p);
    assert.equal(p.entradas[0].seriedad, null);
    assert.equal(contarProblemas(p.entradas), 1);
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

  it('bajo mando no es problema: no aparece ni cuenta', () => {
    const p = problemasDevDe(proyecto, informe('bajo-mando'), null);
    assert.equal(p, null);
  });

  it('deriva sigue contando como problema', () => {
    const p = problemasDevDe(proyecto, informe('deriva'), null);
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 1);
  });
});

/* [por que] Un proceso elevado deja `exe` vacio (CIM no lo lee sin permisos) y el
 * motivo salia como «pid 12528 (pid 12528)»: el pid dos veces y ningun nombre. El
 * cmd es la unica fuente del nombre cuando el exe no llega. */
describe('huerfano: nombre del proceso', () => {
  const huerfano = (over: Partial<HuerfanoDev>): HuerfanoDev =>
    ({ ip: '127.0.0.1', puerto: 5432, pid: 12528, exe: null, cmd: '', verificado: false, clave: null, ...over }) as HuerfanoDev;

  it('sin exe, el nombre sale del cmd (proceso elevado)', () => {
    const p = problemaHuerfanosSinProyecto({ huerfanos: [huerfano({ cmd: '"C:\\Program Files\\PostgreSQL\\16\\bin\\postgres.exe" -D C:\\pgdata' })] } as unknown as InformeDev);
    assert.match(p!.entradas[0].motivo, /sin proyecto: postgres\.exe \(pid 12528\) NO-VERIFICADO/);
  });

  it('sin exe ni cmd se dice desconocido, no el pid dos veces', () => {
    const p = problemaHuerfanosSinProyecto({ huerfanos: [huerfano({})] } as unknown as InformeDev);
    assert.match(p!.entradas[0].motivo, /sin proyecto: proceso desconocido \(pid 12528\)/);
  });

  it('el exe manda sobre el cmd', () => {
    const p = problemaHuerfanosSinProyecto({ huerfanos: [huerfano({ exe: 'C:\\otro\\servicio.exe', cmd: 'algo.exe --x' })] } as unknown as InformeDev);
    assert.match(p!.entradas[0].motivo, /sin proyecto: servicio\.exe/);
  });
});
