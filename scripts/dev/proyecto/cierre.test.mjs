/* Tests de las comprobaciones de cierre (10AA-2 F9.6) que no dependen de Git
 * ni del backend: roadmap, procesos y la clasificación de puertos protegidos. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { raizTemporales } from '../../shared/rutas.mjs';
import { comprobarRoadmap, comprobarProcesos, PUERTOS_PROTEGIDOS } from './cierre.mjs';

/* [por que] AGENTS §0.2: los temporales van a la raíz de temporales, nunca a %TEMP%. */
const BASE_TMP = join(raizTemporales(), 'cierre-tests');

function dirConRoadmap(texto) {
  mkdirSync(BASE_TMP, { recursive: true });
  const dir = mkdtempSync(join(BASE_TMP, 'd-'));
  if (texto !== undefined) writeFileSync(join(dir, 'roadmap.md'), texto);
  return dir;
}

test('roadmap: sin --tarea se omite aunque haya líneas abiertas', () => {
  const dir = dirConRoadmap('- `11AA-1` **ACTIVA (2026-10-11): F9\n');
  try {
    const c = comprobarRoadmap(dir);
    assert.equal(c.ok, true);
    assert.match(c.detalle, /omitida/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: la tarea abierta falla y lista su línea', () => {
  const dir = dirConRoadmap('- `11AA-1` **ACTIVA (2026-10-11): F9\n- otra\n');
  try {
    const c = comprobarRoadmap(dir, '11AA-1');
    assert.equal(c.ok, false);
    assert.equal(c.lineas.length, 1);
    assert.match(c.lineas[0], /11AA-1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: **EN CURSO** también cuenta como abierta', () => {
  const dir = dirConRoadmap('- `11AA-1` **EN CURSO**: F9\n');
  try {
    assert.equal(comprobarRoadmap(dir, '11AA-1').ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: un ID que es prefijo de otro no cuenta', () => {
  const dir = dirConRoadmap('- `11AA-10` **ACTIVA (2026-10-11): otra\n- `11AA-1` HECHA\n');
  try {
    const c = comprobarRoadmap(dir, '11AA-1');
    assert.equal(c.ok, true);
    assert.match(c.detalle, /sin marca abierta/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap ausente o tarea no listada: pasa', () => {
  const sinArchivo = dirConRoadmap(undefined);
  const sinTarea = dirConRoadmap('- `07AA-5` **ACTIVA (2026-10-07): otra\n');
  try {
    assert.match(comprobarRoadmap(sinArchivo, '11AA-1').detalle, /omitida/);
    const c = comprobarRoadmap(sinTarea, '11AA-1');
    assert.equal(c.ok, true);
    assert.match(c.detalle, /no aparece/);
  } finally {
    rmSync(sinArchivo, { recursive: true, force: true });
    rmSync(sinTarea, { recursive: true, force: true });
  }
});

test('procesos: puertos protegidos no cuentan; puerto propio libre pasa', async () => {
  assert.ok(PUERTOS_PROTEGIDOS.includes(8787));
  const c = await comprobarProcesos([8787, 5175]);
  assert.equal(c.ok, true);
});

test('procesos: un puerto propio escuchando falla con su número', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const puerto = srv.address().port;
  try {
    const c = await comprobarProcesos([puerto]);
    assert.equal(c.ok, false);
    assert.match(c.detalle, new RegExp(`escuchan: ${puerto}`));
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
