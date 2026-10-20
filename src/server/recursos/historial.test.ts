/* Test del anillo persistente de recursos (20AA-17): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/recursos/historial.test.ts`.
 * Reloj y ruta inyectados: ningún test toca el fichero de producción. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearHistorialRecursos } from './historial.js';
import {
  MAX_MUESTRAS_RECURSOS,
  RETENCION_RECURSOS_MS,
  type MuestraRecursos,
} from '../../shared/recursosHistorial.js';

const T0 = 1_700_000_000_000_000;
const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

function rutaTemporal(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wm-rec-'));
  temporales.push(dir);
  return join(dir, 'recursos-historial.json');
}

function m(t: number, cpu = 1): MuestraRecursos {
  return [t, cpu, 2, 3, 4, 5, 6, 7, 8];
}

void describe('crearHistorialRecursos', () => {
  void it('anota por tab y no mezcla anillos', () => {
    const h = crearHistorialRecursos({ ruta: rutaTemporal(), ahora: () => T0 });
    h.anotar('vps', m(T0, 1));
    h.anotar('taller', m(T0, 2));
    assert.deepEqual(h.leer('vps'), [m(T0, 1)]);
    assert.deepEqual(h.leer('taller'), [m(T0, 2)]);
  });

  void it('el tab y la muestra se validan fail-closed', () => {
    const h = crearHistorialRecursos({ ruta: rutaTemporal(), ahora: () => T0 });
    h.anotar('otra' as never, m(T0));
    h.anotar('vps', [T0, 1] as never);
    assert.deepEqual(h.leer('vps'), []);
    assert.deepEqual(h.leer('otra' as never), []);
  });

  void it('no repite ni retrocede en el tiempo', () => {
    const h = crearHistorialRecursos({ ruta: rutaTemporal(), ahora: () => T0 });
    h.anotar('vps', m(T0));
    h.anotar('vps', m(T0, 9));
    h.anotar('vps', m(T0 - 1000, 9));
    assert.deepEqual(h.leer('vps'), [m(T0)]);
    h.anotar('vps', m(T0 + 60_000, 9));
    assert.equal(h.leer('vps').length, 2);
  });

  void it('sobrevive a un reinicio (segundo historial sobre el mismo fichero)', () => {
    const ruta = rutaTemporal();
    const a = crearHistorialRecursos({ ruta, ahora: () => T0 });
    a.anotar('vps', m(T0));
    a.anotar('vps', m(T0 + 60_000));
    a.volcar();
    const b = crearHistorialRecursos({ ruta, ahora: () => T0 + 120_000 });
    assert.deepEqual(b.leer('vps'), [m(T0), m(T0 + 60_000)]);
  });

  void it('el volcado va como mucho cada 5 minutos', () => {
    const ruta = rutaTemporal();
    let reloj = T0;
    const h = crearHistorialRecursos({ ruta, ahora: () => reloj });
    h.anotar('vps', m(T0));
    /* El primer volcado es inmediato (nada guardado aún). */
    assert.equal(JSON.parse(readFileSync(ruta, 'utf8')).vps.length, 1);
    reloj = T0 + 60_000;
    h.anotar('vps', m(T0 + 60_000));
    assert.equal(JSON.parse(readFileSync(ruta, 'utf8')).vps.length, 1);
    reloj = T0 + 6 * 60_000;
    h.anotar('vps', m(T0 + 6 * 60_000));
    assert.equal(JSON.parse(readFileSync(ruta, 'utf8')).vps.length, 3);
  });

  void it('recorta al tope y poda lo mayor de 7 días', () => {
    const ruta = rutaTemporal();
    const h = crearHistorialRecursos({ ruta, ahora: () => T0 });
    /* Un segundo entre muestras: 25010 caben de sobra en la retención, así que lo que
     * recorta aquí es el tope y no la poda. */
    for (let i = 0; i < MAX_MUESTRAS_RECURSOS + 10; i++) h.anotar('vps', m(T0 + i * 1000));
    const serie = h.leer('vps');
    assert.equal(serie.length, MAX_MUESTRAS_RECURSOS);
    assert.ok(serie[0][0] > T0);
    const salto = T0 + (MAX_MUESTRAS_RECURSOS + 10) * 1000 + RETENCION_RECURSOS_MS;
    h.anotar('vps', m(salto));
    assert.deepEqual(h.leer('vps'), [m(salto)]);
  });

  void it('fichero corrupto o con basura = anillo vacío, el anotar lo repara', () => {
    const ruta = rutaTemporal();
    writeFileSync(ruta, '{"vps":[[1,2,3]],"otra":[[1,2,3,4,5,6,7,8,9]]}');
    const h = crearHistorialRecursos({ ruta, ahora: () => T0 });
    assert.deepEqual(h.leer('vps'), []);
    assert.deepEqual(h.leer('taller'), []);
    h.anotar('vps', m(T0));
    assert.deepEqual(h.leer('vps'), [m(T0)]);
    const roto = rutaTemporal();
    writeFileSync(roto, 'no-json');
    const h2 = crearHistorialRecursos({ ruta: roto, ahora: () => T0 });
    assert.deepEqual(h2.leer('vps'), []);
  });

  void it('al cargar descarta lo que ya pasó la retención', () => {
    const ruta = rutaTemporal();
    writeFileSync(
      ruta,
      JSON.stringify({ vps: [m(T0), m(T0 + RETENCION_RECURSOS_MS + 1)] }),
    );
    const h = crearHistorialRecursos({ ruta, ahora: () => T0 + RETENCION_RECURSOS_MS + 2 });
    assert.deepEqual(h.leer('vps'), [m(T0 + RETENCION_RECURSOS_MS + 1)]);
  });
});
