/* Test de las puras del historial de recursos (20AA-17): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/shared/recursosHistorial.test.ts`.
 * Sin disco ni DOM: tuplas, topes y sumas a pelo. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MUESTRAS_RECURSOS,
  RETENCION_RECURSOS_MS,
  SECTOR_BYTES,
  esMuestraRecursos,
  esTabRecursos,
  fusionarRecursos,
  muestraDeSnapshot,
  normalizarMuestraRecursos,
  type MuestraRecursos,
} from './recursosHistorial.js';
import type { VpsAgenteSnapshot } from './tipos/vps.js';

const T0 = 1_700_000_000_000_000;

function contenedor(cpuPct: number, memMiB: number, red: number, blk: number) {
  return {
    id: 'c',
    nombre: 'c',
    estado: 'running',
    imagen: 'x',
    cpuPct,
    memMiB,
    memLimiteMiB: null,
    redRxBytes: red,
    redTxBytes: red * 2,
    blkReadBytes: blk,
    blkWriteBytes: blk * 2,
    sitioUuid: null,
    dominio: null,
    sitio: null,
  };
}

function snap(extra: Partial<VpsAgenteSnapshot> = {}): VpsAgenteSnapshot {
  return {
    schema: 1,
    hostId: 'h',
    ts: T0,
    contenedores: [contenedor(2.55, 100.4, 1000, 2000), contenedor(1.05, 200.6, 500, 1000)],
    discoHost: { sectoresLeidos: 10, sectoresEscritos: 20 },
    truncado: false,
    totalContenedores: 2,
    frescura: { fuente: 'agente', edadMs: 0 },
    ...extra,
  };
}

void describe('recursosHistorial compartido', () => {
  void it('esTabRecursos solo admite los anillos conocidos', () => {
    assert.equal(esTabRecursos('vps'), true);
    assert.equal(esTabRecursos('taller'), true);
    assert.equal(esTabRecursos('otra'), false);
    assert.equal(esTabRecursos(''), false);
    assert.equal(esTabRecursos(null), false);
  });

  void it('normalizarMuestraRecursos migra las de 7 campos y descarta lo demás', () => {
    assert.deepEqual(
      normalizarMuestraRecursos([T0, 1, 2, 3, 4, 5, 6], T0 - 1),
      [T0, 1, 2, 3, 4, 5, 6, 0, 0],
    );
    assert.equal(normalizarMuestraRecursos([T0, 1, 2], T0 - 1), null);
    assert.equal(normalizarMuestraRecursos([T0, 1, 2, 3, 4, 5, 6, 7, 'x'], T0 - 1), null);
    assert.equal(normalizarMuestraRecursos('x', T0 - 1), null);
    /* Fuera de retención: no se carga ni se sirve. */
    assert.equal(normalizarMuestraRecursos([T0 - RETENCION_RECURSOS_MS - 1, 0, 0, 0, 0, 0, 0, 0, 0], T0 - RETENCION_RECURSOS_MS), null);
    assert.equal(esMuestraRecursos([T0, 1, 2, 3, 4, 5, 6, 7, 8]), true);
    assert.equal(esMuestraRecursos([T0, 1, 2, 3, 4, 5, 6]), false);
  });

  void it('fusionarRecursos dedupa por t (gana la última lista), ordena y recorta', () => {
    const base = [
      [100, 1, 1, 1, 1, 1, 1, 1, 1],
      [200, 2, 2, 2, 2, 2, 2, 2, 2],
    ] as MuestraRecursos[];
    const viva = [
      [200, 9, 9, 9, 9, 9, 9, 9, 9],
      [300, 3, 3, 3, 3, 3, 3, 3, 3],
    ] as MuestraRecursos[];
    assert.deepEqual(fusionarRecursos(base, viva), [
      [100, 1, 1, 1, 1, 1, 1, 1, 1],
      [200, 9, 9, 9, 9, 9, 9, 9, 9],
      [300, 3, 3, 3, 3, 3, 3, 3, 3],
    ]);
    const larga: MuestraRecursos[] = [];
    for (let i = 0; i < MAX_MUESTRAS_RECURSOS + 5; i++) larga.push([i, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(fusionarRecursos(larga).length, MAX_MUESTRAS_RECURSOS);
  });

  void it('muestraDeSnapshot suma contenedores y convierte sectores a bytes', () => {
    const r = muestraDeSnapshot(snap(), null, T0 + 5000);
    assert.deepEqual(r.muestra, [T0, 3.6, 301, 1500, 3000, 3000, 6000, 10 * SECTOR_BYTES, 20 * SECTOR_BYTES]);
    assert.deepEqual(r.disco, { r: 10 * SECTOR_BYTES, w: 20 * SECTOR_BYTES });
  });

  void it('sin discoHost repite el IO anterior (plano = sin dato, no cero)', () => {
    const previo = { r: 4096, w: 8192 };
    const r = muestraDeSnapshot(snap({ discoHost: null }), previo, T0);
    assert.equal(r.muestra[7], 4096);
    assert.equal(r.muestra[8], 8192);
    assert.deepEqual(r.disco, previo);
    /* Sin dato previo tampoco se inventa: cero. */
    const vacio = muestraDeSnapshot(snap({ discoHost: null }), null, T0);
    assert.equal(vacio.muestra[7], 0);
    assert.equal(vacio.muestra[8], 0);
  });

  void it('el ts del snapshot sano manda; el insano cae al reloj local', () => {
    assert.equal(muestraDeSnapshot(snap(), null, T0 + 10).muestra[0], T0);
    const bogus = muestraDeSnapshot(snap({ ts: 1_700 }), null, T0 + 10);
    assert.equal(bogus.muestra[0], T0 + 10);
  });
});
