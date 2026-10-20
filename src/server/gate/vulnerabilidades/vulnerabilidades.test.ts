import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { agregarAnalisis } from './audit/agregado.js';
import {
  esNoAlcanzable,
  fechaLocal,
  nombrePaqueteValido,
  parsearAudit,
  parsearExcepcionesAudit,
} from './audit/parseo.js';
import type { AnalisisVulnerabilidades } from '../../../shared/types.js';

const R = 'C:/proy';

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

/* Entradas reales de `cargo audit --json` (cargo-audit 0.22.2, proyecto-a,
 * 2026-10-17), recortadas a los campos que se leen. [por que] La prueba anterior
 * usaba una forma imaginada con `severity: 'medium'` dentro del advisory, que no
 * existe: pasaba mientras el camino real estaba roto, porque RUSTSEC no emite
 * `severity` sino `cvss` **como vector de texto**. Estas entradas son las que
 * salieron de verdad, con sus vectores y con el `zip` que no trae `cvss`. */
const CARGO_REAL = {
  vulnerabilities: {
    found: true,
    count: 4,
    list: [
      { advisory: { id: 'RUSTSEC-2026-0346', package: 'rustls', title: '`Debug` impls for client session values expose TLS secrets', cvss: 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:H/I:N/A:N' }, versions: { patched: ['>=0.23.46'] } },
      { advisory: { id: 'RUSTSEC-2026-0349', package: 'rustls', title: 'Unauthenticated ServerHello can downgrade later connections', cvss: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N' }, versions: { patched: ['>=0.23.46'] } },
      { advisory: { id: 'RUSTSEC-2026-0369', package: 'zip', title: 'ZipStreamReader::extract() and ZipArchive::extract() apply Unix permissions', cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H' }, versions: { patched: ['>=9.0.0'] } },
      { advisory: { id: 'RUSTSEC-2026-0368', package: 'zip', title: 'zip: `ZipArchive::extract` creates symbolic links whose attributes it does not control', cvss: null }, versions: { patched: ['>=9.0.0'] } },
    ],
  },
};

test('parsearAudit cargo: la severidad sale del vector CVSS, no de un `severity` inexistente', () => {
  const r = parsearAudit('cargo', CARGO_REAL);
  /* Antes: las cuatro salian 'low' (2 criticas y 2 altas ocultas). */
  assert.deepEqual(
    r.hallazgos.map((h) => [h.id, h.severidad]),
    [
      ['RUSTSEC-2026-0346', 'moderate'],
      ['RUSTSEC-2026-0349', 'low'],
      ['RUSTSEC-2026-0369', 'critical'],
      ['RUSTSEC-2026-0368', 'low'],
    ],
  );
  assert.deepEqual(r.resumen, { critical: 1, high: 0, moderate: 1, low: 2 });
});

test('parsearAudit cargo: sin vector CVSS el aviso se marca, no se rellena con low', () => {
  const r = parsearAudit('cargo', CARGO_REAL);
  const sin = r.hallazgos.find((h) => h.id === 'RUSTSEC-2026-0368');
  assert.equal(sin?.sinSeveridad, true, 'un aviso sin cvss tiene que declararse sin severidad');
  const con = r.hallazgos.find((h) => h.id === 'RUSTSEC-2026-0369');
  assert.ok(!con?.sinSeveridad, 'un aviso con vector no lleva la marca');
});

test('parsearAudit cargo: no trata found/count como paquetes y conserva id y titulo', () => {
  const r = parsearAudit('cargo', CARGO_REAL);
  assert.deepEqual(r.hallazgos.map((h) => h.paquete), ['rustls', 'rustls', 'zip', 'zip']);
  assert.equal(r.hallazgos[0]?.titulo, '`Debug` impls for client session values expose TLS secrets');
  assert.deepEqual(r.hallazgos.map((h) => h.rango), ['>=0.23.46', '>=0.23.46', '>=9.0.0', '>=9.0.0']);
});

test('parsearAudit npm: el titulo y el vector salen de `via`', () => {
  const r = parsearAudit('npm', {
    vulnerabilities: {
      lodash: {
        severity: 'high',
        range: '<4.17.21',
        via: [{ title: 'Prototype Pollution', url: 'https://github.com/advisories/GHSA-xxxx', cvss: { score: 7.5, vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' } }],
      },
    },
  });
  assert.equal(r.hallazgos[0]?.severidad, 'high');
  assert.equal(r.hallazgos[0]?.titulo, 'Prototype Pollution');
});

test('parsearAudit npm: un `via` de solo cadena no aporta titulo y no rompe la severidad', () => {
  const r = parsearAudit('npm', {
    vulnerabilities: { tar: { severity: 'moderate', range: '<6.2.1', via: ['node-gyp'] } },
  });
  assert.deepEqual(r.hallazgos.map((h) => [h.paquete, h.severidad, h.titulo]), [['tar', 'moderate', undefined]]);
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

/* [por que] Un proyecto con dos lockfiles puede degradar en uno y no en el otro:
 * el aviso viaja al agregado y se dice una sola vez, sin perderlo si la parte
 * degradada ademas fallo. */
test('agregarAnalisis: propaga el aviso de degradacion y lo deduplica', () => {
  const texto = 'hecho en local, el taller no respondió (ssh: connect failed)';
  const uno = parte('conHallazgos', { lockfile: 'Cargo.lock', aviso: texto });
  const dos = parte('noAuditable', { lockfile: 'frontend/package-lock.json', aviso: texto, error: 'sin salida' });
  const r = agregarAnalisis('x', [uno, dos]);
  assert.equal(r.aviso, texto);
  assert.equal(r.error, 'frontend/package-lock.json: sin salida');

  /* Sin degradacion no hay aviso: el campo solo aparece cuando hay algo que decir. */
  assert.equal('aviso' in agregarAnalisis('x', [parte('ok')]), false);
});

const TOML_EXCEPCIONES = [
  '[advisories]',
  'ignore = [',
  '    # Motivo largo.',
  '    # Decidido: excepcion de 1 mes (2026-10-12). VENCE 2026-11-12.',
  '    "RUSTSEC-2023-0071",',
  '',
  '    # Sin fecha.',
  '    "RUSTSEC-2024-0370",',
  '    "RUSTSEC-2025-0057",',
  ']',
].join('\n');

test('parsearExcepcionesAudit: vigente antes del vencimiento, vencida desde ese dia, sin fecha cuenta', () => {
  const antes = parsearExcepcionesAudit(TOML_EXCEPCIONES, '2026-10-12');
  assert.deepEqual(antes.vigentes, ['RUSTSEC-2023-0071']);
  assert.deepEqual(antes.vencidas, []);
  assert.deepEqual(antes.sinFecha, ['RUSTSEC-2024-0370', 'RUSTSEC-2025-0057']);

  const dia = parsearExcepcionesAudit(TOML_EXCEPCIONES, '2026-11-12');
  assert.deepEqual(dia.vigentes, []);
  assert.deepEqual(dia.vencidas, ['RUSTSEC-2023-0071']);
});

test('parsearExcepcionesAudit: ignora lo que no tiene forma RUSTSEC (no llega a la shell)', () => {
  const r = parsearExcepcionesAudit('ignore = [\n  "; rm -rf x",\n  "RUSTSEC-bad",\n]', '2026-10-12');
  assert.deepEqual(r, { vigentes: [], vencidas: [], sinFecha: [] });
});

test('fechaLocal: AAAA-MM-DD con ceros (mes 0-indexado)', () => {
  assert.equal(fechaLocal(new Date(2026, 9, 2)), '2026-10-02');
  assert.equal(fechaLocal(new Date(2026, 10, 12)), '2026-11-12');
});

/* [por que] Caso real de proyectos reales (2026-10-18): un solo comentario VENCE
 * cubre varios ids seguidos; los ids de debajo no deben contar como sin fecha. */
test('parsearExcepcionesAudit: varios ids bajo un mismo comentario comparten su VENCE', () => {
  const toml = [
    'ignore = [',
    '    # Motivo zip. Decidido: excepcion de 1 mes (2026-10-18). VENCE 2026-11-18.',
    '    "RUSTSEC-2026-0367",',
    '    "RUSTSEC-2026-0368",',
    '    "RUSTSEC-2026-0369",',
    ']',
  ].join('\n');
  const r = parsearExcepcionesAudit(toml, '2026-10-18');
  assert.deepEqual(r.vigentes, ['RUSTSEC-2026-0367', 'RUSTSEC-2026-0368', 'RUSTSEC-2026-0369']);
  assert.deepEqual(r.sinFecha, []);
});

test('parsearExcepcionesAudit: un comentario nuevo tras un id no hereda el VENCE del grupo anterior', () => {
  const toml = [
    'ignore = [',
    '    # Primero. VENCE 2026-11-13.',
    '    "RUSTSEC-2023-0071",',
    '    # Segundo, sin fecha.',
    '    "RUSTSEC-2024-0370",',
    ']',
  ].join('\n');
  const r = parsearExcepcionesAudit(toml, '2026-10-18');
  assert.deepEqual(r.vigentes, ['RUSTSEC-2023-0071']);
  assert.deepEqual(r.sinFecha, ['RUSTSEC-2024-0370']);
});
