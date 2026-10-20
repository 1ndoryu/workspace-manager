/* Pruebas de la cache del snapshot: el estado git no puede quedarse congelado.
 * [por que] El tablero servía un snapshot escaneado antes de un commit («16 sin
 * commitear» con el repo limpio). Ahora, pasada la vigencia, se relee solo git. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { actualizarSnapshot, obtenerSnapshot, rutaCache } from './cache.js';
import type { SnapshotWorkspace } from '../shared/types.js';

/* Las raíces temporales de cada snapshot se anotan para borrarlas al acabar el
 * fichero. Sin esto quedan restos /tmp/wm-cache-* que purga cm-sweep en la VPS 89. */
const temporales: string[] = [];
after(() => {
  for (const dir of temporales) rmSync(dir, { recursive: true, force: true });
});

function snapshot(escaneadoEn: string, gitEn?: string, sucio = 0): SnapshotWorkspace {
  const raiz = mkdtempSync(join(tmpdir(), 'wm-cache-'));
  temporales.push(raiz);
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

/* [por que] Un `forzar` que llega con un escaneo ya en marcha no debe unirse a él:
 * ese escaneo pudo leer la config antes del último cambio. Un escaneo normal sí se comparte. */
test('forzar no se une a un escaneo en curso; uno normal sí', async () => {
  const base = snapshot(hace(1_000));
  let llamadas = 0;
  let abrir!: () => void;
  const puerta = new Promise<void>((r) => (abrir = r));
  const lento = async () => {
    llamadas++;
    await puerta;
    return base;
  };
  const primero = obtenerSnapshot(base.raiz, lento, true, async (s) => s);
  const unido = obtenerSnapshot(base.raiz, lento, false, async (s) => s);
  const forzado = obtenerSnapshot(base.raiz, lento, true, async (s) => s);
  await new Promise((r) => setImmediate(r));
  abrir();
  await Promise.all([primero, unido, forzado]);
  assert.equal(llamadas, 2);
});

/* [por que] Varias peticiones con el git caducado deben compartir una sola relectura de git. */
test('git caducado: peticiones simultáneas comparten una relectura', async () => {
  const viejo = snapshot(hace(120_000), hace(120_000));
  actualizarSnapshot(viejo);
  let llamadas = 0;
  let abrir!: () => void;
  const puerta = new Promise<void>((r) => (abrir = r));
  const releerGit = async (s: SnapshotWorkspace) => {
    llamadas++;
    await puerta;
    return { ...s, gitEn: new Date().toISOString() };
  };
  const pedidos = [1, 2, 3].map(() => obtenerSnapshot(viejo.raiz, async () => viejo, false, releerGit));
  await new Promise((r) => setImmediate(r));
  abrir();
  await Promise.all(pedidos);
  assert.equal(llamadas, 1);
});
