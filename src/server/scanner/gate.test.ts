/* Estilos del gate: sin hojas de estilo, varsense no se marca "ausente".
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/scanner/gate.test.ts
 * [por que] Los temporales van bajo la raíz de temporales (AGENTS.md §0.2), nunca en %TEMP% ni en el repo. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../plataforma/sistema/temporales.js';
import { estadoGate, hayEstilos } from './gate.js';

describe('gate: sinEstilos', () => {
  let raiz: string;

  before(() => {
    mkdirSync(raizTemporales(), { recursive: true });
    raiz = mkdtempSync(join(raizTemporales(), 'gate-test-'));
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('proyecto con sentinel y sin CSS: no hay estilos', () => {
    const p = mkdtempSync(join(raiz, 'sin-css-'));
    writeFileSync(join(p, 'sentinel.config.json'), '{}');
    writeFileSync(join(p, 'index.js'), '');
    assert.equal(hayEstilos(p), false);
    const g = estadoGate(p);
    assert.equal(g.declarado, true);
    assert.equal(g.sinEstilos, true);
  });

  it('CSS anidado encuentra estilos y no marca sinEstilos', () => {
    const p = mkdtempSync(join(raiz, 'con-css-'));
    writeFileSync(join(p, 'sentinel.config.json'), '{}');
    mkdirSync(join(p, 'src', 'ui'), { recursive: true });
    writeFileSync(join(p, 'src', 'ui', 'tema.scss'), '');
    assert.equal(hayEstilos(p), true);
    assert.equal(estadoGate(p).sinEstilos, false);
  });

  it('ignora CSS dentro de node_modules y ocultos', () => {
    const p = mkdtempSync(join(raiz, 'ignorados-'));
    mkdirSync(join(p, 'node_modules', 'lib'), { recursive: true });
    mkdirSync(join(p, '.cache'), { recursive: true });
    writeFileSync(join(p, 'node_modules', 'lib', 'a.css'), '');
    writeFileSync(join(p, '.cache', 'b.css'), '');
    assert.equal(hayEstilos(p), false);
  });

  it('tailwind.config cuenta como estilos', () => {
    const p = mkdtempSync(join(raiz, 'tailwind-'));
    writeFileSync(join(p, 'tailwind.config.ts'), '');
    assert.equal(hayEstilos(p), true);
  });

  it('con varsense.config.json no se calcula sinEstilos', () => {
    const p = mkdtempSync(join(raiz, 'con-varsense-'));
    writeFileSync(join(p, 'sentinel.config.json'), '{}');
    writeFileSync(join(p, 'varsense.config.json'), '{}');
    const g = estadoGate(p);
    assert.equal(g.varsense, true);
    assert.equal(g.sinEstilos, false);
  });
});

/* [17AA-5] El alta (`scripts/dev/proyecto/alta`) y el tablero deciden con la misma pregunta
 * «¿este proyecto tiene estilos?», pero en runtimes distintos: el `.mjs` no puede importar el
 * `.ts`. Antes no coincidían (el alta solo miraba `.css` hasta 3 niveles), así que un proyecto
 * con SCSS salía «sin CSS propio» en el alta y el tablero sí le exigía varsense. Esta guarda
 * compara los dos veredictos sobre el mismo árbol: si una regla cambia sin la otra, falla. */
async function cargarHayCssAlta(): Promise<(ruta: string) => boolean> {
  const mod = (await import(
    new URL('../../../scripts/dev/proyecto/alta/altaComprobaciones.mjs', import.meta.url).href
  )) as { hayCss: (ruta: string) => boolean };
  return mod.hayCss;
}

describe('detección de estilos: alta y tablero coinciden', () => {
  let raiz: string;

  before(() => {
    mkdirSync(raizTemporales(), { recursive: true });
    raiz = mkdtempSync(join(raizTemporales(), 'estilos-gemelos-'));
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  const casos: { nombre: string; crear: (p: string) => void }[] = [
    {
      nombre: 'SCSS anidado',
      crear: (p) => {
        mkdirSync(join(p, 'src', 'ui'), { recursive: true });
        writeFileSync(join(p, 'src', 'ui', 'tema.scss'), '');
      },
    },
    { nombre: 'tailwind.config', crear: (p) => writeFileSync(join(p, 'tailwind.config.js'), '') },
    {
      nombre: 'CSS solo en carpeta oculta',
      crear: (p) => {
        mkdirSync(join(p, '.cache'), { recursive: true });
        writeFileSync(join(p, '.cache', 'a.css'), '');
      },
    },
    {
      nombre: 'CSS solo en node_modules',
      crear: (p) => {
        mkdirSync(join(p, 'node_modules', 'lib'), { recursive: true });
        writeFileSync(join(p, 'node_modules', 'lib', 'a.css'), '');
      },
    },
    {
      nombre: 'CSS solo en build',
      crear: (p) => {
        mkdirSync(join(p, 'build'), { recursive: true });
        writeFileSync(join(p, 'build', 'a.css'), '');
      },
    },
    { nombre: 'sin estilos', crear: (p) => writeFileSync(join(p, 'index.js'), '') },
  ];

  it('mismos veredictos sobre el mismo árbol', async () => {
    const hayCssAlta = await cargarHayCssAlta();
    for (const caso of casos) {
      const p = mkdtempSync(join(raiz, 'caso-'));
      caso.crear(p);
      assert.equal(hayCssAlta(p), hayEstilos(p), caso.nombre);
    }
  });
});
