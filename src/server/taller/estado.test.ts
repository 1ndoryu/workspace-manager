/* Pruebas de las funciones puras de estado.ts: parser de sesiones Mutagen y registro de
 * conformidad. La lectura real (SSH, PowerShell) no se prueba aquí: es E/S. La sonda de
 * hosts públicos sí, con un `fetch` falso inyectado: su decisión (¿hay Access delante?)
 * es lo único que impide que un dev quede expuesto, y no debe depender de la red. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argsSondaTaller, parsearHistorial, pedirPublico, sesionesMutagenMalas } from './estado.js';
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
  /* [por que] Los nombres de sesión salen del registro privado: el test fija la forma
   * (`dev-<proyecto>-<puerto>`) y qué puertos son remotos, no los nombres de los proyectos. */
  assert.ok(r.sesionesDev.length > 0, 'el registro declara sesiones dev remotas');
  assert.ok(r.sesionesDev.every((s) => /^dev-.+-\d+$/.test(s)), 'forma dev-<proyecto>-<puerto>');
  assert.ok(!r.sesionesDev.some((s) => s.endsWith('-3102')), 'el 3102 no es remoto');
  /* [por que] El host real vive en config/registro.json (local, fuera del repo): el test
   * no fija su nombre, solo que hay al menos un host público y sale del registro. */
  assert.ok(r.hostsPublicos.length > 0, 'el registro declara hosts públicos');
  /* El puerto público de MN es 3110 desde el repunte de 16AA-18 (registro.json);
   * 5199 sigue siendo puerto de dev, pero ya no se publica. */
  assert.ok(r.puertosLocalesPublicos.includes(3110));
  assert.ok(!r.puertosLocalesPublicos.includes(5199));
  assert.ok(r.sitiosRust.some((s) => s.buildMode === 'builder'));
});

/* [por que] 20AA-21: lo que se rompió no fue la lectura de la config sino el cableado — la sonda
 * de la 89 ya sabía leer `WM_CLOUDFLARED_ENV`, pero el manager no se la pasaba, así que publicaba
 * `tokenModo: null` siempre y la conformidad marcaba «sin fichero de token» aunque el fichero
 * existiera con modo 600. Estas pruebas fijan el argv exacto que se envía por `ssh`. */
test('argsSondaTaller: pasa por entorno el nombre de la BD y la ruta del token del túnel', () => {
  const ruta = '/srv/cloudflared/tunel.env';
  const t = {
    proyectos: { MN: { basedatos: 'glory_backend_inmobiliaria', bdDesdeLocal: { verificar: [] } } },
    devPublico: { envToken: ruta },
  };
  assert.deepEqual(argsSondaTaller(t), [
    'env',
    'TALLER_BD_TRABAJO=glory_backend_inmobiliaria',
    `WM_CLOUDFLARED_ENV=${ruta}`,
    '$HOME/bin/taller-estado',
  ]);
});

test('argsSondaTaller: una ruta que no vale no se cuela en la línea de comandos del ssh', () => {
  const conRuta = (envToken: unknown) => argsSondaTaller({ devPublico: { envToken } });
  const vacia = (envToken: unknown) => conRuta(envToken).includes('WM_CLOUDFLARED_ENV=');
  /* Relativa: la sonda hace `stat` sin expandir la virgulilla. Con salto de línea: sería una
   * segunda orden dentro del argv. Y sin taller configurado no hay ruta que ofrecer. */
  assert.ok(vacia('~/.config/cloudflared/tunel.env'));
  assert.ok(vacia('/srv/cloudflared\ntunel.env'));
  assert.ok(vacia(null));
  assert.ok(!vacia('/srv/cloudflared/tunel.env'), 'una ruta válida sí llega');
});
