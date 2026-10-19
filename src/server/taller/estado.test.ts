/* Pruebas de las funciones puras de estado.ts: parser de sesiones Mutagen y registro de
 * conformidad. La lectura real (SSH, PowerShell) no se prueba aquí: es E/S. La sonda de
 * hosts públicos sí, con un `fetch` falso inyectado: su decisión (¿hay Access delante?)
 * es lo único que impide que un dev quede expuesto, y no debe depender de la red. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearHistorial, pedirPublico, sesionesMutagenMalas } from './estado.js';
import { leerRegistroConformidad } from './registroConformidad.js';

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

const BLOQUE_SANO = `Name: taller-sistema-legado
Identifier: sync_abc
Status: Watching for changes
`;

test('Mutagen: sesión en Watching no es mala', () => {
  assert.deepEqual(sesionesMutagenMalas(BLOQUE_SANO), []);
});

test('Mutagen: sesión pausada o con conflictos se marca con su estado', () => {
  const salida = `${BLOQUE_SANO}
Name: taller-sitio-api
Identifier: sync_def
Status: Paused
Name: taller-otra
Status: Watching for changes
Conflicts:
  a.txt
`;
  assert.deepEqual(sesionesMutagenMalas(salida), [
    'taller-sitio-api (Paused)',
    'taller-otra (Watching for changes)',
  ]);
});

test('Mutagen: sesiones fuera del prefijo taller- se ignoran', () => {
  assert.deepEqual(sesionesMutagenMalas('Name: otra\nStatus: Paused\n'), []);
});

/* Respuesta falsa: lo que se prueba es la decisión (¿redirige a Access?), no la red. */
function respuesta(status: number, location: string | null): Response {
  return new Response(null, { status, headers: location ? { location } : {} });
}

test('Público: un 302 a Access deja el host detrás de la puerta', async () => {
  const r = await pedirPublico('sitio-dev.ejemplo.test', () =>
    Promise.resolve(respuesta(302, 'https://equipo.cloudflareaccess.com/cdn-cgi/access/login')));
  assert.equal(r.status, 302);
  assert.match(r.location ?? '', /cloudflareaccess/);
  assert.equal(r.error, null);
});

test('Público: un hostname inválido no sale a la red', async () => {
  let llamado = false;
  const r = await pedirPublico('no vale/../x', () => {
    llamado = true;
    return Promise.resolve(respuesta(200, null));
  });
  assert.equal(llamado, false, 'no debe pedirse un host que no es hostname');
  assert.equal(r.status, null);
  assert.match(r.error ?? '', /no válido/);
});

test('Público: un fallo de red se reporta acotado, sin lanzar', async () => {
  const r = await pedirPublico('sitio-dev.ejemplo.test', () => Promise.reject(new Error('x'.repeat(500))));
  assert.equal(r.status, null);
  assert.equal(r.location, null);
  assert.equal((r.error ?? '').length, 120);
});

test('Registro: las sesiones dev de MN salen de host + puertos remotos', () => {
  const r = leerRegistroConformidad();
  assert.ok(r.sesionesDev.includes('dev-MN-Inmobiliaria-3110'));
  assert.ok(r.sesionesDev.includes('dev-MN-Inmobiliaria-5199'));
  assert.ok(!r.sesionesDev.includes('dev-MN-Inmobiliaria-3102'), 'el 3102 no es remoto');
  assert.ok(r.hostsPublicos.includes('mn-dev.wandori.us'));
  /* El puerto público de MN es 3110 desde el repunte de 16AA-18 (registro.json);
   * 5199 sigue siendo puerto de dev, pero ya no se publica. */
  assert.ok(r.puertosLocalesPublicos.includes(3110));
  assert.ok(!r.puertosLocalesPublicos.includes(5199));
  assert.ok(r.sitiosRust.some((s) => s.buildMode === 'builder'));
});
