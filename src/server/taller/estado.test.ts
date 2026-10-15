/* Pruebas de las funciones puras de estado.ts: parser de sesiones Mutagen y registro de
 * conformidad. La lectura real (SSH, PowerShell, HTTP) no se prueba aquí: es E/S. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerRegistroConformidad, parsearHistorial, sesionesMutagenMalas } from './estado.js';

/* Línea de estado.jsonl con la forma que escribe `taller-estado --registrar`. */
function linea(tomadaEn: string, libreGb: number): string {
  return JSON.stringify({
    version: 1,
    tomadaEn,
    disco: { libreGb },
    sweep: { edadHoras: 1, timerActivo: true },
    memoria: { disponibleMiB: 4000, swapUsadaMiB: 0 },
    escuchas: [],
    tmux: [],
    cmHeavy: { ocupado: false },
    buildsFueraDeCmHeavy: [],
    secretos: [],
    cloudflared: { version: '2026.1.0', tokenModo: '600', viva: true },
    bdTrabajo: { existe: true, edadHoras: null },
    managerDaemonVivo: false,
  });
}

test('Historial: conserva las muestras válidas en orden y descarta líneas rotas o de otra versión', () => {
  const texto = [
    linea('2026-10-15T10:00:00Z', 50),
    '{ linea rota',
    linea('2026-10-15T10:05:00Z', 49).replace('"version":1', '"version":2'),
    linea('2026-10-15T10:10:00Z', 48),
    '',
  ].join('\n');
  const muestras = parsearHistorial(texto);
  assert.deepEqual(muestras.map((m) => m.tomadaEn), ['2026-10-15T10:00:00Z', '2026-10-15T10:10:00Z']);
  assert.equal(muestras[1].libreGb, 48);
  assert.equal(muestras[1].cloudflaredViva, true);
});

test('Historial: sin líneas válidas devuelve lista vacía', () => {
  assert.deepEqual(parsearHistorial(''), []);
  assert.deepEqual(parsearHistorial('no json\n{"version":1}\n'), []);
});

const BLOQUE_SANO = `Name: taller-RESTAURANTE
Identifier: sync_abc
Status: Watching for changes
`;

test('Mutagen: sesión en Watching no es mala', () => {
  assert.deepEqual(sesionesMutagenMalas(BLOQUE_SANO), []);
});

test('Mutagen: sesión pausada o con conflictos se marca con su estado', () => {
  const salida = `${BLOQUE_SANO}
Name: taller-MN-Inmobiliaria
Identifier: sync_def
Status: Paused
Name: taller-otra
Status: Watching for changes
Conflicts:
  a.txt
`;
  assert.deepEqual(sesionesMutagenMalas(salida), [
    'taller-MN-Inmobiliaria (Paused)',
    'taller-otra (Watching for changes)',
  ]);
});

test('Mutagen: sesiones fuera del prefijo taller- se ignoran', () => {
  assert.deepEqual(sesionesMutagenMalas('Name: otra\nStatus: Paused\n'), []);
});

test('Registro: las sesiones dev de MN salen de host + puertos remotos', () => {
  const r = leerRegistroConformidad();
  assert.ok(r.sesionesDev.includes('dev-MN-Inmobiliaria-3110'));
  assert.ok(r.sesionesDev.includes('dev-MN-Inmobiliaria-5199'));
  assert.ok(!r.sesionesDev.includes('dev-MN-Inmobiliaria-3102'), 'el 3102 no es remoto');
  assert.ok(r.hostsPublicos.includes('mn-dev.wandori.us'));
  assert.ok(r.puertosLocalesPublicos.includes(5199));
  assert.ok(r.sitiosRust.some((s) => s.buildMode === 'builder'));
});
