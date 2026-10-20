/* Analisis del roadmap con la forma del protocolo (D8 de AGENTS-detalle.md).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/scanner/roadmap/roadmap.test.ts
 * [por que] El tablero solo ve trabajo abierto si las tareas tienen la forma canonica; cada
 * variante real que se encontro en el area (negrita, tabla, heading, casilla sin ID) tiene su
 * caso, con su control negativo. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../../plataforma/temporales.js';
import { TOPE_LINEAS_ROADMAP, analizarRoadmap, resumenRoadmap } from './roadmap.js';

const motivos = (texto: string): string[] => analizarRoadmap(texto).problemas.map((p) => p.motivo);

describe('roadmap: tarea canonica', () => {
  it('lee ID y titulo de la linea del protocolo', () => {
    const a = analizarRoadmap('# Roadmap — x\n\n## Pendientes\n\n- [ ] `19AA-4` — **Coherencia del mapa.** Cuerpo.\n');
    assert.deepEqual(a.tareas, [{ id: '19AA-4', titulo: '**Coherencia del mapa.** Cuerpo.', linea: 5 }]);
    assert.deepEqual(a.problemas, []);
  });

  it('la casilla sin ID es un problema de formato', () => {
    assert.deepEqual(motivos('## Pendientes\n\n- [ ] **Pin de Sentinel (aparcado).**\n'), [
      'casilla sin ID en la forma del protocolo',
    ]);
  });

  it('la casilla marcada es un problema: las completadas no viven en el roadmap', () => {
    assert.deepEqual(motivos('## Pendientes\n\n- [x] `T2` — **Algo.**\n'), [
      'tarea completada dentro del roadmap (va a Agente/completados/)',
    ]);
  });

  it('el bullet con ID en negrita (forma vieja) es un problema', () => {
    assert.deepEqual(motivos('## Pendientes\n\n- **18AA-7 — Algo.** Cuerpo.\n'), ['tarea sin casilla']);
    assert.deepEqual(motivos('## Pendientes\n\n1. **T3 — Numerada.**\n'), ['tarea sin casilla']);
  });

  it('el heading con ID y la fila de tabla son problemas', () => {
    assert.deepEqual(motivos('## Pendientes\n\n### T5 Arquitectura (medio).\n'), ['tarea escrita como heading']);
    assert.deepEqual(motivos('## Pendientes\n\n| ID | Tarea |\n| --- | --- |\n| `S17` | Ficha |\n'), ['tarea en tabla']);
  });
});

describe('roadmap: lo que no es una tarea', () => {
  it('fuera de una zona de tareas, un bullet con ID es prosa', () => {
    const texto = '# Roadmap — x\n\n## Bloqueos\n\n- `16A-5` — **CERRADO (2026-10-17):** otra cosa.\n';
    assert.deepEqual(analizarRoadmap(texto).problemas, []);
  });

  it('una mencion en prosa dentro de una tarea no crea otra tarea', () => {
    const texto = '## Pendientes\n\n- [ ] `19AA-1` — **Otra.** Depende de `19AA-9`.\n';
    assert.deepEqual(analizarRoadmap(texto).tareas.map((t) => t.id), ['19AA-1']);
  });

  it('las casillas sangradas son sub-pasos y los bloques de codigo se ignoran', () => {
    const texto = [
      '## Pendientes',
      '',
      '- [ ] `T5` — **Con sub-pasos.**',
      '  - [ ] apiEndpointAnalyzer.ts',
      '  - [x] otra cosa',
      '',
      '```text',
      '- [ ] `NO-1` ejemplo dentro de un bloque',
      '```',
      '',
    ].join('\n');
    const a = analizarRoadmap(texto);
    assert.deepEqual(a.tareas.map((t) => t.id), ['T5']);
    assert.deepEqual(a.problemas, []);
  });
});

describe('roadmap: secciones', () => {
  it('reconoce las canonicas con adornos y singular', () => {
    const texto = [
      '## Contexto',
      '## Siguiente bloque',
      '## 🔴 Pendiente crítico',
      '## Pendientes (orden de dependencia)',
      '## Tareas pendientes (orden de dependencia)',
      '## Bloqueos y decisiones',
      '## Planes activos',
    ].join('\n');
    const a = analizarRoadmap(texto);
    assert.deepEqual(a.faltantes, []);
    assert.deepEqual(a.noCanonicas, []);
  });

  it('nombra lo que falta y lo que sobra', () => {
    const a = analizarRoadmap('# Roadmap — x\n\n## Hecho\n\n- algo\n');
    assert.deepEqual(a.faltantes, ['Siguiente bloque', 'Pendientes', 'Bloqueos', 'Planes activos']);
    assert.deepEqual(a.noCanonicas, ['Hecho']);
  });

  it('lee los planes declarados activos', () => {
    const texto =
      '## Planes activos\n\n- `Agente/planes/plan-x-2026-10-19.md` — `19AA-5`.\n- `Agente/planes/plan-y-2026-10-17.md` — `17AA-2`.\n';
    assert.deepEqual(analizarRoadmap(texto).planes, ['plan-x-2026-10-19.md', 'plan-y-2026-10-17.md']);
  });
});

describe('roadmap: resumenRoadmap', () => {
  let raiz: string;

  before(() => {
    mkdirSync(raizTemporales(), { recursive: true });
    raiz = mkdtempSync(join(raizTemporales(), 'roadmap-test-'));
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('sin roadmap.md devuelve el resumen vacio', () => {
    const p = mkdtempSync(join(raiz, 'sin-roadmap-'));
    assert.deepEqual(resumenRoadmap(p), {
      pendientes: 0,
      activos: 0,
      ids: [],
      tareas: [],
      resumen: '',
      lineas: 0,
      problemas: 0,
      faltantes: [],
      planes: [],
    });
  });

  it('cuenta pendientes, planes, lineas y problemas de formato', () => {
    const p = mkdtempSync(join(raiz, 'con-roadmap-'));
    writeFileSync(
      join(p, 'roadmap.md'),
      [
        '# Roadmap — x',
        '',
        '## Pendientes',
        '',
        '- [ ] `19AA-1` — **Una.**',
        '- [ ] `19AA-2` — **Otra.**',
        '- [ ] sin ID',
        '',
        '## Bloqueos',
        '## Planes activos',
        '',
        '- `Agente/planes/plan-x-2026-10-19.md` — `19AA-1`.',
        '',
      ].join('\n'),
    );
    const r = resumenRoadmap(p);
    assert.equal(r.pendientes, 2);
    assert.equal(r.activos, 1);
    assert.equal(r.problemas, 1);
    assert.deepEqual(r.planes, ['plan-x-2026-10-19.md']);
    assert.deepEqual(r.faltantes, ['Siguiente bloque']);
    assert.match(r.resumen, /Una/);
    assert.ok(r.lineas > 0);
    /* ID y titulo viajan al tablero: la consola los lista como problema 'pendiente'. */
    assert.deepEqual(r.tareas, [
      { id: '19AA-1', titulo: '**Una.**' },
      { id: '19AA-2', titulo: '**Otra.**' },
    ]);
  });

  it('el tope del protocolo son 400 lineas', () => {
    assert.equal(TOPE_LINEAS_ROADMAP, 400);
  });
});
