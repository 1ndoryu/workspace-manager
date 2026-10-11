/* Test de los topes del Guardián (10AA-2 F11.4): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/guardian/topes.test.ts`.
 * Fixtures en C:/tmp (protocolo de temporales): ningún test toca proyectos reales. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guardarTopes, validarCambioTopes, type HashesTopes, type ResultadoGuardado } from './topes.js';
import { escribirAtomico, hashDe } from '../escritura.js';
import { leerOverride, leerPolitica } from './lector.js';
import { ErrorValidacion } from './politica.js';

const BASE_TMP = 'C:/tmp/guardian-test';
const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

function raizTmp(): string {
  mkdirSync(BASE_TMP, { recursive: true });
  const d = mkdtempSync(join(BASE_TMP, 'topes-'));
  temporales.push(d);
  return d;
}

const HOY = '2026-10-11';

/* Configuraciones con el formato de workspace-manager: CRLF, sangría 2 y 4. */
const CON_BUDGETS_MODO = [
  '{',
  '  "schemaVersion": 2,',
  '  "mode": "enforce",',
  '  "budgets": {',
  '    "mode": "observe"',
  '  },',
  '  "guard": {',
  '    "directCommands": {',
  '      "npmScripts": ["lint", "test"]',
  '    }',
  '  }',
  '}',
  '',
].join('\r\n');
const CON_LIMITES = [
  '{',
  '  "schemaVersion": 2,',
  '  "mode": "enforce",',
  '  "budgets": {',
  '    "mode": "enforce",',
  '    "otra": true,',
  '    "limits": {',
  '      "cargo-check": 2,',
  '      "cargo-test": 4',
  '    }',
  '  }',
  '}',
  '',
].join('\r\n');
const SIN_BUDGETS = '{\r\n  "schemaVersion": 2,\r\n  "mode": "enforce"\r\n}\r\n';

/* Escribe los ficheros y devuelve los hashes que la página tendría. */
function fijar(raiz: string, config: string, extra?: string): HashesTopes {
  writeFileSync(join(raiz, 'sentinel.config.json'), config, 'utf8');
  if (extra !== undefined) writeFileSync(join(raiz, 'lote-extra.md'), extra, 'utf8');
  return { config: hashDe(config), extra: extra === undefined ? null : hashDe(extra) };
}

function leerTexto(raiz: string, fichero: string): string {
  return readFileSync(join(raiz, fichero), 'utf8');
}

function budgetsDe(raiz: string): unknown {
  return (JSON.parse(leerTexto(raiz, 'sentinel.config.json')) as { budgets?: unknown }).budgets;
}

function soloCRLF(texto: string): boolean {
  return !/(^|[^\r])\n/u.test(texto);
}

/* Escritor espía: registra las rutas que intentaría escribir, sin escribir. */
function espia(llamadas: string[]): (ruta: string, contenido: string) => void {
  return (ruta) => {
    llamadas.push(ruta);
  };
}

function exigirOk(res: ResultadoGuardado): asserts res is Extract<ResultadoGuardado, { estado: 'ok' }> {
  if (res.estado !== 'ok') assert.fail(`se esperaba ok y llegó ${res.estado}: ${res.motivo}`);
}

describe('validarCambioTopes', () => {
  it('rechaza clases, topes y modos que Sentinel no aplica', () => {
    const malos: unknown[] = [
      { limites: { 'mi-clase': 1 } },
      { limites: { 'cargo-check': 101 } },
      { limites: { 'cargo-check': 1.5 } },
      { limites: { 'cargo-check': '2' } },
      { modo: 'strict' },
      { extraTotal: -1 },
      { extraTotal: 101 },
      'nada',
    ];
    for (const m of malos) assert.throws(() => validarCambioTopes(m), ErrorValidacion, JSON.stringify(m));
  });

  it('el motivo queda en una línea y acotado', () => {
    assert.equal(validarCambioTopes({ motivo: 'a\n b\t\tc' }).motivo, 'a b c');
    assert.equal(validarCambioTopes({ motivo: 'x'.repeat(300) }).motivo?.length, 120);
  });
});

describe('budgets de sentinel.config.json', () => {
  it('cambia modo y limits sin tocar el resto del texto (CRLF)', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO);
    const res = guardarTopes(r, previo, { modo: 'enforce', limites: { 'cargo-check': 2 } }, HOY);
    exigirOk(res);
    const texto = leerTexto(r, 'sentinel.config.json');
    assert.ok(soloCRLF(texto));
    assert.ok(texto.includes('  "schemaVersion": 2,\r\n  "mode": "enforce",\r\n'));
    assert.ok(texto.includes('"npmScripts": ["lint", "test"]'));
    const p = leerPolitica(r);
    assert.equal(p.modo, 'enforce');
    assert.deepEqual(p.limites, { 'cargo-check': 2 });
    assert.equal(res.hashes.config, hashDe(texto));
  });

  it('quita una clave con null y conserva las claves ajenas', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_LIMITES);
    exigirOk(guardarTopes(r, previo, { limites: { 'cargo-check': null } }, HOY));
    assert.deepEqual(budgetsDe(r), { mode: 'enforce', otra: true, limits: { 'cargo-test': 4 } });
  });

  it('quitar la última clave borra limits', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_LIMITES);
    exigirOk(guardarTopes(r, previo, { limites: { 'cargo-check': null, 'cargo-test': null } }, HOY));
    assert.deepEqual(budgetsDe(r), { mode: 'enforce', otra: true });
  });

  it('crea budgets al final del objeto raíz si falta', () => {
    const r = raizTmp();
    const previo = fijar(r, SIN_BUDGETS);
    exigirOk(guardarTopes(r, previo, { limites: { 'tsc-noemit': 3 } }, HOY));
    const texto = leerTexto(r, 'sentinel.config.json');
    assert.ok(soloCRLF(texto));
    assert.deepEqual(JSON.parse(texto), { schemaVersion: 2, mode: 'enforce', budgets: { limits: { 'tsc-noemit': 3 } } });
  });

  it('sin cambios no escribe nada', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO);
    const llamadas: string[] = [];
    const res = guardarTopes(r, previo, { modo: 'observe' }, HOY, espia(llamadas));
    exigirOk(res);
    assert.equal(res.cambia, false);
    assert.deepEqual(llamadas, []);
  });

  it('hash previo distinto → conflicto y no escribe', () => {
    const r = raizTmp();
    fijar(r, CON_BUDGETS_MODO);
    const llamadas: string[] = [];
    const res = guardarTopes(r, { config: 'otro', extra: null }, { modo: 'enforce' }, HOY, espia(llamadas));
    assert.equal(res.estado, 'conflicto');
    assert.deepEqual(llamadas, []);
  });

  it('budgets que no es objeto → ErrorValidacion y el fichero intacto', () => {
    const r = raizTmp();
    const original = '{\r\n  "budgets": 3\r\n}\r\n';
    const previo = fijar(r, original);
    assert.throws(() => guardarTopes(r, previo, { modo: 'enforce' }, HOY), ErrorValidacion);
    assert.equal(leerTexto(r, 'sentinel.config.json'), original);
  });

  it('sin sentinel.config.json → error, no conflicto', () => {
    const r = raizTmp();
    const res = guardarTopes(r, { config: 'x', extra: null }, { modo: 'enforce' }, HOY);
    assert.equal(res.estado, 'error');
    assert.match(res.motivo, /sentinel\.config\.json/u);
  });
});

describe('lote-extra.md', () => {
  it('crea el fichero con la línea +N y el motivo', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO);
    exigirOk(guardarTopes(r, previo, { extraTotal: 3, motivo: 'espiral fmt' }, HOY));
    assert.equal(leerTexto(r, 'lote-extra.md'), '+3 espiral fmt (2026-10-11)\n');
    assert.equal(leerOverride(r).extra, 3);
  });

  it('ampliar: la línea nueva va arriba y el historial queda debajo', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO, '+3 espiral fmt (2026-10-07)\r\nnota antigua\r\n');
    exigirOk(guardarTopes(r, previo, { extraTotal: 5, motivo: 'lote 2' }, HOY));
    assert.equal(
      leerTexto(r, 'lote-extra.md'),
      '+5 lote 2 (2026-10-11)\r\n+3 espiral fmt (2026-10-07)\r\nnota antigua\r\n',
    );
    assert.equal(leerOverride(r).extra, 5);
  });

  it('una fecha antes del +N cuenta como cifra: el total va en la primera línea', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO, '2026-10-07 +3 espiral\n');
    exigirOk(guardarTopes(r, previo, { extraTotal: 0 }, HOY));
    assert.equal(leerOverride(r).extra, 0);
    assert.ok(leerTexto(r, 'lote-extra.md').startsWith('+0 '));
  });

  it('total igual al efectivo no toca el fichero', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO, '+3 espiral\n');
    const llamadas: string[] = [];
    const res = guardarTopes(r, previo, { extraTotal: 3 }, HOY, espia(llamadas));
    exigirOk(res);
    assert.equal(res.cambia, false);
    assert.deepEqual(llamadas, []);
  });

  it('conflicto si lote-extra.md cambió desde la lectura', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO, '+1 viejo\n');
    const res = guardarTopes(r, { config: previo.config, extra: hashDe('otro\n') }, { extraTotal: 2 }, HOY);
    assert.equal(res.estado, 'conflicto');
  });

  it('si escribir lote-extra.md falla, revierte sentinel.config.json', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO, '+1 viejo\n');
    const escribeSalvoExtra = (ruta: string, contenido: string): void => {
      if (ruta.endsWith('lote-extra.md')) throw new Error('disco lleno');
      escribirAtomico(ruta, contenido);
    };
    const res = guardarTopes(r, previo, { modo: 'enforce', extraTotal: 2 }, HOY, escribeSalvoExtra);
    assert.equal(res.estado, 'error');
    assert.equal(res.configRevertida, true);
    assert.equal(leerTexto(r, 'sentinel.config.json'), CON_BUDGETS_MODO);
    assert.equal(leerTexto(r, 'lote-extra.md'), '+1 viejo\n');
  });

  it('los hashes devueltos coinciden con lo escrito', () => {
    const r = raizTmp();
    const previo = fijar(r, CON_BUDGETS_MODO, '+1 viejo\n');
    const res = guardarTopes(r, previo, { modo: 'enforce', extraTotal: 2 }, HOY);
    exigirOk(res);
    assert.equal(res.hashes.config, hashDe(leerTexto(r, 'sentinel.config.json')));
    assert.equal(res.hashes.extra, hashDe(leerTexto(r, 'lote-extra.md')));
  });
});
