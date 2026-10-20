/* Test de la política guard (F11.4): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/guardian/politica.test.ts`
 * (el repo no tiene runner TS; node --test solo entiende JS). Fixtures en tmp:
 * ningún test toca proyectos reales. Los textos de política usan CRLF y el
 * formato real de sentinel.config.json, porque la edición depende de él. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../../plataforma/sistema/temporales.js';
import { escribirAtomico, hashDe } from '../escritura.js';
import {
  aplicarPlantilla,
  calcularEdicion,
  diferenciasPlantilla,
  ErrorValidacion,
  guardarEdicion,
  guardarLote,
  leerPolitica,
  planificarCambio,
  validarCambio,
  validarEntradas,
  validarPolitica,
  type Listas,
  type Plantilla,
} from './politica.js';

const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

/* [por que] Fixtures en la raíz de temporales, no en %TEMP%: el protocolo del área pide los
 * temporales fuera del sistema. */
const BASE_TMP = join(raizTemporales(), 'guardian-test');

function raizTmp(): string {
  mkdirSync(BASE_TMP, { recursive: true });
  const d = mkdtempSync(join(BASE_TMP, 'politica-'));
  temporales.push(d);
  return d;
}

const POLITICA = [
  '{',
  '  "schemaVersion": 2,',
  '  "mode": "enforce",',
  '  "budgets": {',
  '    "mode": "enforce"',
  '  },',
  '  "guard": {',
  '    "directCommands": {',
  '      "npmScripts": ["lint", "test", "build", "check"],',
  '      "npxTools": ["eslint", "tsc", "typescript", "vitest"],',
  '      "cargoSubcommands": [],',
  '      "tools": ["tsc", "vitest", "eslint", "git"]',
  '    }',
  '  }',
  '}',
  '',
].join('\r\n');

const PLANTILLA: Plantilla = {
  schemaVersion: 1,
  quitarDeTools: ['git', 'python', 'pip'],
  plantillas: {
    ts: { npxTools: ['tsc', 'vitest', 'eslint'], tools: ['tsc', 'vitest', 'eslint'] },
    rust: { cargoSubcommands: ['check', 'clippy', 'test', 'bench', 'fmt', 'nextest'] },
  },
  stackDeProyecto: {},
};

/* Lectura ok o error del test: evita narrowing con assert.fail. */
function hashDeRaiz(raiz: string): string {
  const l = leerPolitica(raiz);
  if (l.estado !== 'ok') throw new Error(JSON.stringify(l));
  return l.hash;
}

function conPolitica(texto = POLITICA): string {
  const r = raizTmp();
  writeFileSync(join(r, 'sentinel.config.json'), texto, 'utf8');
  return r;
}

describe('validarEntradas y validarCambio', () => {
  it('acepta nombres válidos y elimina duplicados', () => {
    assert.deepEqual(validarEntradas(['tsc', 'tsc', 'npm:test'], 'tools'), ['tsc', 'npm:test']);
  });
  it('rechaza metacaracteres, vacíos y no listas', () => {
    assert.throws(() => validarEntradas(['tsc && rm'], 'tools'), ErrorValidacion);
    assert.throws(() => validarEntradas(['-x'], 'tools'), ErrorValidacion);
    assert.throws(() => validarEntradas([''], 'tools'), ErrorValidacion);
    assert.throws(() => validarEntradas('tsc', 'tools'), ErrorValidacion);
  });
  it('rechaza modos y listas desconocidas', () => {
    assert.throws(() => validarCambio({ modo: 'permitir-todo' }), ErrorValidacion);
    assert.throws(() => validarCambio({ listas: { otra: [] } }), ErrorValidacion);
  });
});

describe('validarPolitica y leerPolitica', () => {
  it('rechaza schemaVersion distinta de 2 (espejo de Sentinel)', () => {
    const r = validarPolitica({ schemaVersion: 1, mode: 'enforce', guard: { directCommands: {} } });
    assert.equal(r.ok, false);
  });
  it('invalida con JSON roto y ausente sin fichero', () => {
    assert.equal(leerPolitica(conPolitica('{no json')).estado, 'invalida');
    assert.equal(leerPolitica(raizTmp()).estado, 'ausente');
  });
  it('ok con la política real y sus listas', () => {
    const l = leerPolitica(conPolitica());
    assert.equal(l.estado, 'ok');
    if (l.estado !== 'ok') return;
    assert.equal(l.modo, 'enforce');
    assert.deepEqual(l.listas.cargoSubcommands, []);
  });
  it('symlink → invalida (no se edita fuera del proyecto)', (t) => {
    const destino = conPolitica();
    const raiz = raizTmp();
    try {
      symlinkSync(join(destino, 'sentinel.config.json'), join(raiz, 'sentinel.config.json'), 'file');
    } catch {
      t.skip('sin permiso para crear symlinks en Windows');
      return;
    }
    assert.equal(leerPolitica(raiz).estado, 'invalida');
  });
});

describe('planificarCambio', () => {
  it('cambia mode y una lista inline sin tocar el resto del texto', () => {
    const plan = planificarCambio(POLITICA, { modo: 'observe', listas: { npxTools: ['tsc', 'vitest'] } });
    assert.equal(plan.cambia, true);
    assert.ok(plan.nuevo.includes('  "mode": "observe",'));
    assert.ok(plan.nuevo.includes('      "npxTools": ["tsc", "vitest"],'));
    assert.ok(plan.nuevo.includes('"budgets": {\r\n    "mode": "enforce"'), 'budgets no debe cambiar');
    assert.equal(plan.nuevo.split('\n').length, POLITICA.split('\n').length, 'mismo número de líneas');
    assert.ok(plan.diff);
  });
  it('conserva el estilo multilínea de una lista', () => {
    const multilinea = POLITICA.replace(
      '"npmScripts": ["lint", "test", "build", "check"],',
      '"npmScripts": [\r\n        "lint",\r\n        "test"\r\n      ],',
    );
    const plan = planificarCambio(multilinea, { listas: { npmScripts: ['lint'] } });
    assert.ok(plan.nuevo.includes('      "npmScripts": [\r\n        "lint"\r\n      ],'));
  });
  it('vacía una lista a [] y sin cambios no toca nada', () => {
    const vacia = planificarCambio(POLITICA, { listas: { tools: [] } });
    assert.ok(vacia.nuevo.includes('"tools": []'));
    const igual = planificarCambio(POLITICA, { modo: 'enforce', listas: { npxTools: ['eslint', 'tsc', 'typescript', 'vitest'] } });
    assert.equal(igual.cambia, false);
    assert.equal(igual.diff, null);
  });
});

describe('plantilla por stack', () => {
  const base: Listas = {
    npmScripts: ['lint'],
    npxTools: ['eslint'],
    cargoSubcommands: [],
    tools: ['tsc', 'git', 'python', 'pip'],
  };
  it('quita git, python y pip de tools y une el stack ts', () => {
    const r = aplicarPlantilla(base, ['ts'], PLANTILLA);
    assert.deepEqual(r.tools, ['tsc', 'vitest', 'eslint']);
    assert.deepEqual(r.npxTools, ['eslint', 'tsc', 'vitest']);
  });
  it('añade cargoSubcommands del stack rust', () => {
    const r = aplicarPlantilla(base, ['rust'], PLANTILLA);
    assert.deepEqual(r.cargoSubcommands, ['check', 'clippy', 'test', 'bench', 'fmt', 'nextest']);
  });
  it('diferencias: faltan entradas y reaparecen las prohibidas', () => {
    const d = diferenciasPlantilla(base, ['ts'], PLANTILLA);
    assert.ok(d.faltan.includes('npxTools:tsc'));
    assert.deepEqual(d.reaparecen, ['tools:git', 'tools:python', 'tools:pip']);
  });
});

describe('calcularEdicion y guardarEdicion', () => {
  it('hash previo distinto → conflicto, sin escribir', () => {
    const r = conPolitica();
    const res = calcularEdicion(r, 'hash-viejo', { modo: 'observe' });
    assert.equal(res.estado, 'conflicto');
  });
  it('escribe el cambio y devuelve el hash nuevo', () => {
    const r = conPolitica();
    const res = guardarEdicion(r, hashDeRaiz(r), { modo: 'observe' });
    assert.equal(res.estado, 'ok');
    if (res.estado !== 'ok') return;
    const leido = readFileSync(join(r, 'sentinel.config.json'), 'utf8');
    assert.ok(leido.includes('"mode": "observe"'));
    assert.equal(res.hash, hashDe(leido));
    assert.equal(hashDeRaiz(r), res.hash);
  });
  it('no escribe si el fichero cambió después de leerlo', () => {
    const r = conPolitica();
    const previo = hashDeRaiz(r);
    writeFileSync(join(r, 'sentinel.config.json'), POLITICA.replace('"enforce"', '"pass-through"'), 'utf8');
    const res = guardarEdicion(r, previo, { modo: 'observe' });
    assert.equal(res.estado, 'conflicto');
  });
  it('sin cambios no toca el fichero', () => {
    const r = conPolitica();
    const antes = readFileSync(join(r, 'sentinel.config.json'), 'utf8');
    const res = guardarEdicion(r, hashDeRaiz(r), { modo: 'enforce' });
    assert.equal(res.estado, 'ok');
    assert.equal(readFileSync(join(r, 'sentinel.config.json'), 'utf8'), antes);
  });
});

describe('guardarLote', () => {
  it('si un proyecto no es válido, no escribe en ninguno', () => {
    const a = conPolitica();
    const b = conPolitica();
    const antesA = readFileSync(join(a, 'sentinel.config.json'), 'utf8');
    const res = guardarLote([
      { clave: 'a', raiz: a, hashPrevio: hashDeRaiz(a), cambio: { modo: 'observe' } },
      { clave: 'b', raiz: b, hashPrevio: 'hash-viejo', cambio: { modo: 'observe' } },
    ]);
    assert.equal(res.ok, false);
    assert.equal(readFileSync(join(a, 'sentinel.config.json'), 'utf8'), antesA);
  });
  it('si una escritura falla a mitad, revierte las ya escritas', () => {
    const a = conPolitica();
    const b = conPolitica();
    const antesA = readFileSync(join(a, 'sentinel.config.json'), 'utf8');
    let llamadas = 0;
    const escribir = (ruta: string, contenido: string): void => {
      llamadas++;
      if (llamadas === 2) throw new Error('disco lleno');
      escribirAtomico(ruta, contenido);
    };
    const res = guardarLote(
      [
        { clave: 'a', raiz: a, hashPrevio: hashDeRaiz(a), cambio: { modo: 'observe' } },
        { clave: 'b', raiz: b, hashPrevio: hashDeRaiz(b), cambio: { modo: 'observe' } },
      ],
      escribir,
    );
    assert.equal(res.ok, false);
    assert.deepEqual(res.revertidas, ['a']);
    assert.deepEqual(res.sinRevertir, []);
    assert.equal(readFileSync(join(a, 'sentinel.config.json'), 'utf8'), antesA);
    assert.equal(readFileSync(join(b, 'sentinel.config.json'), 'utf8'), POLITICA);
  });
  it('lote completo escribe todos', () => {
    const a = conPolitica();
    const b = conPolitica();
    const res = guardarLote([
      { clave: 'a', raiz: a, hashPrevio: hashDeRaiz(a), cambio: { modo: 'observe' } },
      { clave: 'b', raiz: b, hashPrevio: hashDeRaiz(b), cambio: { modo: 'observe' } },
    ]);
    assert.equal(res.ok, true);
    assert.ok(readFileSync(join(a, 'sentinel.config.json'), 'utf8').includes('"observe"'));
    assert.ok(readFileSync(join(b, 'sentinel.config.json'), 'utf8').includes('"observe"'));
  });
});
