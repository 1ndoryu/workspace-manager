/* Pruebas de la cache del snapshot: el estado git no puede quedarse congelado.
 * [por que] El tablero servía un snapshot escaneado antes de un commit («16 sin
 * commitear» con el repo limpio). Ahora, pasada la vigencia, se relee solo git. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { actualizarSnapshot, obtenerSnapshot, rutaCache } from './cache.js';
import type { SnapshotWorkspace } from '../shared/types.js';

function snapshot(escaneadoEn: string, gitEn?: string, sucio = 0): SnapshotWorkspace {
  const raiz = mkdtempSync(join(tmpdir(), 'wm-cache-'));
  return {
    escaneadoEn,
    gitEn,
    raiz,
    proyectos: [],
    agentes: [],
    resumen: { total: sucio, repos: 0, worktrees: 0, carpetas: 0, dirty: sucio, conGate: 0, pendientesRoadmap: 0 },
  } as unknown as SnapshotWorkspace;
}

const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

test('snapshot con git fresco se sirve sin releer git', async () => {
  const base = snapshot(hace(120_000), hace(1_000));
  actualizarSnapshot(base);
  let llamadas = 0;
  const r = await obtenerSnapshot(base.raiz, async () => base, false, async (s) => {
    llamadas++;
    return s;
  });
  assert.equal(llamadas, 0);
  assert.equal(r.snapshot, base);
});

test('git caducado se relee y la cache en disco guarda el nuevo estado', async () => {
  const viejo = snapshot(hace(120_000), hace(120_000), 16);
  actualizarSnapshot(viejo);
  const r = await obtenerSnapshot(viejo.raiz, async () => viejo, false, async (s) => ({
    ...s,
    resumen: { ...s.resumen, dirty: 0 },
    gitEn: new Date().toISOString(),
  }));
  assert.equal(r.snapshot.resumen.dirty, 0);
  const enDisco = JSON.parse(readFileSync(rutaCache(viejo.raiz), 'utf8'));
  assert.equal(enDisco.resumen.dirty, 0);
});

test('sin gitEn cuenta desde escaneadoEn', async () => {
  const sinGit = snapshot(hace(120_000));
  actualizarSnapshot(sinGit);
  let llamadas = 0;
  await obtenerSnapshot(sinGit.raiz, async () => sinGit, false, async (s) => {
    llamadas++;
    return s;
  });
  assert.equal(llamadas, 1);
});
