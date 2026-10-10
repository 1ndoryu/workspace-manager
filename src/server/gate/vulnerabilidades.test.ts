import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  agregarAnalisis,
  detectarLockfiles,
  esNoAlcanzable,
  nombrePaqueteValido,
  parsearAudit,
} from './vulnerabilidades.js';
import type { AnalisisVulnerabilidades } from '../../shared/types.js';

const R = 'C:/proy';

test('detectarLockfiles: pnpm gana a npm en la misma carpeta y audita cada subcarpeta', () => {
  const existen = new Set([
    join(R, 'pnpm-lock.yaml'),
    join(R, 'package-lock.json'),
    join(R, 'Cargo.lock'),
    join(R, 'frontend', 'package-lock.json'),
    join(R, 'glory-rs', 'Cargo.lock'),
  ]);
  const locks = detectarLockfiles(R, (ruta) => existen.has(ruta));
  assert.deepEqual(
    locks.map((l) => [l.lockfile, l.gestor]),
    [
      ['pnpm-lock.yaml', 'pnpm'],
      ['Cargo.lock', 'cargo'],
      ['frontend/package-lock.json', 'npm'],
      ['glory-rs/Cargo.lock', 'cargo'],
    ],
  );
});

test('detectarLockfiles: sin lockfile devuelve lista vacia', () => {
  assert.deepEqual(detectarLockfiles(R, () => false), []);
});

test('parsearAudit npm: mapa paquete -> severidad, resumen derivado de los hallazgos', () => {
  const r = parsearAudit('npm', {
    vulnerabilities: {
      lodash: { severity: 'high', range: '<4.17.21' },
      minimist: { severity: 'moderate', range: '<1.2.6' },
    },
  });
  assert.deepEqual(r.resumen, { critical: 0, high: 1, moderate: 1, low: 0 });
  assert.deepEqual(
    r.hallazgos.map((h) => [h.paquete, h.severidad]),
    [
      ['lodash', 'high'],
      ['minimist', 'moderate'],
    ],
  );
});

test('parsearAudit pnpm: lista sin metadata cuenta sus hallazgos (no sale ok)', () => {
  const r = parsearAudit('pnpm', {
    vulnerabilities: [{ name: 'axios', severity: 'critical', range: '<1.6.0' }],
  });
  assert.equal(r.resumen.critical, 1);
  assert.equal(r.hallazgos.length, 1);
});

test('parsearAudit cargo: forma {list} lee advisory.package y no trata found/count como paquetes', () => {
  const r = parsearAudit('cargo', {
    vulnerabilities: {
      found: true,
      count: 1,
      list: [
        {
          advisory: { package: 'rsa', severity: 'medium', id: 'RUSTSEC-2023-0071' },
          versions: { patched: [] },
        },
      ],
    },
  });
  assert.deepEqual(
    r.hallazgos.map((h) => h.paquete),
    ['rsa'],
  );
  assert.equal(r.resumen.moderate, 1);
});

test('nombrePaqueteValido solo acepta nombres de crate; ningun caracter de shell', () => {
  assert.equal(nombrePaqueteValido('serde_json'), true);
  assert.equal(nombrePaqueteValido('rsa'), true);
  assert.equal(nombrePaqueteValido('rsa & calc'), false);
  assert.equal(nombrePaqueteValido('x;rm'), false);
  assert.equal(nombrePaqueteValido(''), false);
});

test('esNoAlcanzable: solo exit 0 con salida vacia; exit distinto, timeout o salida son alcanzables', () => {
  assert.equal(esNoAlcanzable(0, ''), true);
  assert.equal(esNoAlcanzable(0, '  \n'), true);
  assert.equal(esNoAlcanzable(101, ''), false);
  assert.equal(esNoAlcanzable(null, ''), false);
  assert.equal(esNoAlcanzable(0, 'rsa v0.9.10'), false);
});

function parte(
  estado: AnalisisVulnerabilidades['estado'],
  extra: Partial<AnalisisVulnerabilidades> = {},
): AnalisisVulnerabilidades {
  return {
    clave: 'x',
    gestor: 'npm',
    lockfile: 'package-lock.json',
    estado,
    analizadoEn: '2026-10-10T00:00:00.000Z',
    resumen: { critical: 0, high: 0, moderate: 0, low: 0 },
    hallazgos: [],
    ...extra,
  };
}

test('agregarAnalisis: conHallazgos gana a error, error a noAuditable, noAuditable a ok', () => {
  assert.equal(agregarAnalisis('x', [parte('error', { error: 'boom' }), parte('conHallazgos')]).estado, 'conHallazgos');
  assert.equal(agregarAnalisis('x', [parte('ok'), parte('error', { error: 'boom' })]).estado, 'error');
  assert.equal(agregarAnalisis('x', [parte('ok'), parte('noAuditable')]).estado, 'noAuditable');
  assert.equal(agregarAnalisis('x', [parte('ok'), parte('ok')]).estado, 'ok');
});

test('agregarAnalisis: suma resumen y une lockfiles', () => {
  const uno = parte('conHallazgos', {
    resumen: { critical: 1, high: 0, moderate: 0, low: 0 },
    lockfile: 'Cargo.lock',
    gestor: 'cargo',
  });
  const dos = parte('conHallazgos', {
    resumen: { critical: 0, high: 2, moderate: 0, low: 0 },
    lockfile: 'frontend/package-lock.json',
  });
  const r = agregarAnalisis('x', [uno, dos]);
  assert.deepEqual(r.resumen, { critical: 1, high: 2, moderate: 0, low: 0 });
  assert.equal(r.lockfile, 'Cargo.lock, frontend/package-lock.json');
  assert.equal(r.gestor, 'cargo');
});
