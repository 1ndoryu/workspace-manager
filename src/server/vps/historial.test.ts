/* Test del historial persistente VPS (07AA-4 F1): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/vps/historial.test.ts`
 * (el repo no tiene runner TS; node --test solo entiende JS). Reloj y ruta
 * inyectados: ningún test toca el fichero de producción. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearHistorial, claveValida } from './historial.js';
import {
  HIST_INTERVALO_MS,
  HIST_MAX_MUESTRAS,
  HIST_RETENCION_MS,
  claveSitio,
  esMuestra,
  fusionarSeries,
  normalizarTs,
} from '../../shared/historialVps.js';

const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

function rutaTemporal(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wm-hist-'));
  temporales.push(dir);
  return join(dir, 'vps-historial.json');
}

const FILAS = [
  { sitio: 'glory-rest', cpuPct: 2.5, memMiB: 128 },
  { sitio: 'glory-rest', cpuPct: 1.5, memMiB: 64 },
  { sitio: null, cpuPct: 0.1, memMiB: 8 },
];

void describe('historialVps compartido', () => {
  void it('claveSitio replica la clave de la tabla', () => {
    assert.equal(claveSitio('glory-rest'), 'sitio:glory-rest');
    assert.equal(claveSitio(null), 'infra');
    assert.equal(claveSitio(undefined), 'infra');
  });

  void it('normalizarTs prefiere el ts de pulse en ms y cae al reloj', () => {
    assert.equal(normalizarTs(1759100000000, 1759100005000), 1759100000000);
    assert.equal(normalizarTs(1759100000, 1759100005000), 1759100005000);
    assert.equal(normalizarTs('x', 7), 7);
    assert.equal(normalizarTs(99999999999999, 1000), 1000);
  });

  void it('fusionarSeries dedupa por t, ordena y recorta a la cola', () => {
    const base = [
      [100, 1, 10],
      [200, 2, 20],
    ] as [number, number, number][];
    const viva = [
      [200, 3, 30],
      [300, 4, 40],
    ] as [number, number, number][];
    const f = fusionarSeries(base, viva);
    assert.deepEqual(f, [
      [100, 1, 10],
      [200, 3, 30],
      [300, 4, 40],
    ]);
    assert.equal(esMuestra([1, 2]), false);
    assert.equal(esMuestra([1, 2, 3]), true);
  });
});

void describe('crearHistorial', () => {
  void it('agrupa por sitio, suma e infra aparte', () => {
    const h = crearHistorial({ ruta: rutaTemporal(), ahora: () => 1_000_000_000_100_000 });
    h.anotar(FILAS, 1_000_000_000_100_000);
    assert.deepEqual(h.leer('sitio:glory-rest'), [[1_000_000_000_100_000, 4, 192]]);
    assert.deepEqual(h.leer('infra'), [[1_000_000_000_100_000, 0.1, 8]]);
  });

  void it('throttle: mismo t o <30 s no añade muestra', () => {
    const t0 = 1_000_000_000_200_000;
    const h = crearHistorial({ ruta: rutaTemporal(), ahora: () => t0 });
    h.anotar(FILAS, t0);
    h.anotar(FILAS, t0);
    h.anotar(FILAS, t0 + HIST_INTERVALO_MS - 1);
    assert.equal(h.leer('sitio:glory-rest').length, 1);
    h.anotar(FILAS, t0 + HIST_INTERVALO_MS);
    assert.equal(h.leer('sitio:glory-rest').length, 2);
  });

  void it('recorta al tope y poda lo mayor de 7 días', () => {
    const t0 = 1_700_000_000_000_000;
    let tick = 0;
    const h = crearHistorial({ ruta: rutaTemporal(), ahora: () => t0 + tick });
    for (let i = 0; i < HIST_MAX_MUESTRAS + 10; i++) {
      tick = i * HIST_INTERVALO_MS;
      h.anotar(FILAS, t0 + tick);
    }
    const serie = h.leer('sitio:glory-rest');
    assert.equal(serie.length, HIST_MAX_MUESTRAS);
    /* La primera muestra (t0) cayó por tope aunque aún retenible. */
    assert.ok(serie[0][0] > t0);
    /* Salto mayor que la retención: todo lo viejo se poda al anotar. */
    tick += HIST_RETENCION_MS + HIST_INTERVALO_MS;
    h.anotar(FILAS, t0 + tick);
    assert.equal(h.leer('sitio:glory-rest').length, 1);
  });

  void it('fichero corrupto o ausente = historia vacía, el anotar lo repara', () => {
    const ruta = rutaTemporal();
    const h = crearHistorial({ ruta, ahora: () => 1_000_000_000_300_000 });
    assert.deepEqual(h.leer('sitio:x'), []);
    h.anotar(FILAS, 1_000_000_000_300_000);
    assert.equal(h.leer('sitio:glory-rest').length, 1);
  });

  void it('filas no numéricas no rompen ni anotan', () => {
    const h = crearHistorial({ ruta: rutaTemporal(), ahora: () => 1_000_000_000_400_000 });
    h.anotar(
      [
        { sitio: 'a', cpuPct: Number.NaN, memMiB: 1 },
        { sitio: 'a', cpuPct: 1, memMiB: Number.POSITIVE_INFINITY },
      ],
      1_000_000_000_400_000,
    );
    assert.deepEqual(h.leer('sitio:a'), []);
  });

  void it('claveValida es fail-closed', () => {
    assert.equal(claveValida('infra'), true);
    assert.equal(claveValida('sitio:glory-rest'), true);
    assert.equal(claveValida('sitio:'), false);
    assert.equal(claveValida('../../x'), false);
    assert.equal(claveValida(''), false);
  });
});
