/* Regresión del incidente del router (109A-9, 2026-09-10).
 *
 * Qué pasó: `bump --tool sentinel --write` escribía routers también en modo pin.
 * En el host, la ruta del router coincide con el adapter canónico, así que el
 * adapter quedó sustituido por un router que delegaba en sí mismo (recursión) y
 * los 9 consumidores de familia A apuntaron a ese archivo roto.
 *
 * Estos tests fijan las tres invariantes que lo habrían detenido:
 *   1. en el host el router NUNCA se escribe (estado `host`);
 *   2. sin `--write` no se escribe ningún router, en ningún consumidor;
 *   3. los archivos canónicos siguen siendo adapters, no routers.
 * Se ejecuta con: `npm run quality:bump:test` (node --test, sin red ni suites).
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BUMP = path.join(AQUI, 'bump.mjs');
const HOST = path.resolve(AQUI, '..', '..');
const CANONICOS = ['quality-setup.mjs', 'lock-generator.mjs'];
/* Marcas del template de router: si aparecen en un archivo canónico, el host fue
 * sobrescrito. Se busca el texto, no el hash, para que un cambio legítimo del
 * adapter no vuelva frágil el test. */
const MARCA_ROUTER = 'router: el adapter resuelve al propio router';
const MARCA_ADAPTER = "from './certificacion.mjs'";

function bump(args) {
  const resultado = spawnSync(process.execPath, [BUMP, ...args], {
    cwd: HOST,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    status: typeof resultado.status === 'number' ? resultado.status : 2,
    salida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
  };
}

function routersEnShims() {
  const { salida } = bump(['--shims', '--json']);
  const inicio = salida.indexOf('{');
  const fin = salida.lastIndexOf('}');
  assert.ok(inicio >= 0 && fin > inicio, `--shims --json no devolvió JSON:\n${salida}`);
  return JSON.parse(salida.slice(inicio, fin + 1)).filas;
}

test('el host reporta `host` en sus routers y nunca se reescribe a sí mismo', () => {
  const filas = routersEnShims();
  const host = filas.find(fila => fila.proyecto === 'workspace-manager');
  assert.ok(host, 'el host debe aparecer entre los consumidores de familia A');
  for (const router of host.routers) {
    assert.equal(router.estado, 'host', `${router.router} en el host no puede tratarse como router`);
  }
});

test('sin --write ningún consumidor recibe routers nuevos', () => {
  const filas = routersEnShims();
  for (const fila of filas) {
    for (const router of fila.routers) {
      assert.ok(
        ['ok', 'host', 'drift', 'ausente'].includes(router.estado),
        `${fila.proyecto}/${router.router}: estado de escritura ${router.estado} en dry-run`,
      );
    }
  }
});

test('los archivos canónicos siguen siendo el adapter, no un router', () => {
  for (const archivo of CANONICOS) {
    const texto = fs.readFileSync(path.join(AQUI, archivo), 'utf8');
    assert.ok(!texto.includes(MARCA_ROUTER), `${archivo} fue sobrescrito por un router`);
  }
  assert.ok(
    fs.readFileSync(path.join(AQUI, 'quality-setup.mjs'), 'utf8').includes(MARCA_ADAPTER),
    'quality-setup.mjs canónico debe seguir integrando la certificación compartida',
  );
});

test('un bump de pin en dry-run no toca ningún archivo', () => {
  const rutas = [];
  for (const archivo of CANONICOS) rutas.push(path.join(AQUI, archivo));
  for (const proyecto of ['GLORYPORT', 'PROYECTO TASKS']) {
    for (const archivo of CANONICOS) {
      const ruta = path.resolve(HOST, '..', proyecto, 'scripts', 'quality', archivo);
      if (fs.existsSync(ruta)) rutas.push(ruta);
    }
  }
  const antes = rutas.map(ruta => fs.readFileSync(ruta, 'utf8'));
  const { status } = bump(['--tool', 'sentinel']);
  assert.equal(status, 0, 'el bump de pin en dry-run debe salir 0');
  rutas.forEach((ruta, indice) => {
    assert.equal(fs.readFileSync(ruta, 'utf8'), antes[indice], `${ruta} cambió en un dry-run`);
  });
});

/* Regresión del resumen mentiroso del dry-run (2026-10-16).
 *
 * Qué pasaba: el resumen contaba solo las filas `cambiado`, una rama que exige
 * `--write`, así que un dry-run imprimía "0 manifiesto(s) por reescribir" justo
 * debajo de una tabla con trece filas "cambiaría". El número que interesa antes
 * de escribir es justo el que se iba a escribir.
 *
 * Cobertura declarada: es una invariante, no un caso con fixture. Si el área
 * está alineada, el esperado es 0 y el código viejo también daba 0, así que el
 * test no discrimina; lo que sí impide es que el resumen vuelva a contradecir a
 * la tabla que tiene encima.
 */
test('el resumen del dry-run cuenta lo mismo que la tabla', () => {
  const { salida: json } = bump(['--tool', 'sentinel', '--json']);
  const inicio = json.indexOf('{');
  const fin = json.lastIndexOf('}');
  assert.ok(inicio >= 0 && fin > inicio, `--json no devolvió JSON:\n${json}`);
  const filas = JSON.parse(json.slice(inicio, fin + 1)).filas;
  const pendientes = filas.filter(fila => fila.pin === 'cambiaría').length;

  const { status, salida } = bump(['--tool', 'sentinel']);
  assert.equal(status, 0, 'el bump de pin en dry-run debe salir 0');
  const resumen = salida.split('\n').find(linea => linea.includes('manifiesto(s) por reescribir'));
  assert.ok(resumen, `el dry-run no imprimió el resumen:\n${salida}`);
  assert.ok(
    resumen.includes(`· ${pendientes} manifiesto(s) por reescribir`),
    `el resumen dice "${resumen.trim()}" pero la tabla tiene ${pendientes} fila(s) "cambiaría"`,
  );
});
