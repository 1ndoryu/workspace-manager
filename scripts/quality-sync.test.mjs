/*
 * Prueba de la guarda de consistencia del gate (viñeta 112, 16A-4).
 *
 * Tres defectos reales que se reproducen aquí contra el script de verdad
 * (`WS_AREA_ROOT` apunta a un área de mentira montada para la prueba):
 *  1. los checkouts compartidos LIMPIOS contaban como 2 problemas fantasma;
 *  2. un consumidor que apunta al checkout del arnés salía desync por no
 *     apuntar al compartido, aunque su pin coincidiera con el suyo;
 *  3. un directorio ausente se diagnosticaba como «consumidor con gate sin
 *     quality-tools.json (desync)» en vez de «no está en el área».
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { raizTemporales } from './shared/rutas.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SYNC = path.join(AQUI, 'quality-sync.mjs');
const BASE_TMP = process.env.QUALITY_TEST_TMP ?? raizTemporales();

/* Fixture: nombres inventados con la FORMA del reparto real (checkout
 * compartido, checkout del arnés, familia A, familia B, sin varsense, sin
 * directorio). [por qué] Antes eran los nombres de verdad de nuestra área: eso
 * ataba la prueba a nuestra configuración —un clon con otros proyectos no podía
 * pasarla— y publicaba nuestra lista de proyectos. Aquí solo importa la forma.
 * `AR.quality-consumidores.json` la escribe el propio fixture (abajo), así que
 * la prueba no depende de la config privada de nadie. */
const FAMILIA_A = [
  'app-alfa',
  'app-beta',
  'sitio-web',
  'cli-herramientas',
  'panel-datos',
  'app-movil',
  'lib-comun',
  'app-gamma',
  'sitio-api',
  'app-escritorio',
];
const FAMILIA_B = ['portal-clientes', 'sitio-publico'];
const DEL_ARNES = ['sistema-legado', 'plugin-editor', 'juego-arcade', 'arnes-pruebas'];
/* El único del arnés que además declara varsense. */
const ARNES_CON_VARSENSE = 'arnes-pruebas';
/* Proyecto suelto del área, con pin compartido y sin varsense. */
const SUELTO = 'utilidad-sistema';
const SIN_VARSENSE = new Set([SUELTO, 'plugin-editor', 'juego-arcade', 'app-alfa']);
const SIN_DIRECTORIO = {
  'cliente-uno': path.join('TRABAJOS CLIENTES', 'cliente-uno'),
  'puente-x': 'puente-x',
  'inspector-z': 'inspector-z',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')} en ${cwd}: ${r.stderr}`);
  return (r.stdout ?? '').trim();
}

/* Repo git con un commit vacío; devuelve el hash (los pines se comparan a 12). */
function repo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--quiet');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '--allow-empty', '-m', 'fixture');
  return git(dir, 'rev-parse', 'HEAD');
}

function manifiesto(area, nombre, { commit, commitVarsense }) {
  const dir = path.join(area, nombre);
  fs.mkdirSync(dir, { recursive: true });
  const tools = {};
  if (commit) tools.sentinel = { commit, sourcePath: null, provisionPath: null, version: '0.0.1' };
  if (commitVarsense) tools.varsense = { commit: commitVarsense, sourcePath: null, provisionPath: null, version: '0.0.2' };
  fs.writeFileSync(path.join(dir, 'quality-tools.json'), `${JSON.stringify({ schemaVersion: 1, tools }, null, 2)}\n`);
  return { dir, tools };
}

/* Monta un área mínima pero con la forma real: checkout compartido, checkout
 * del arnés, familia A, familia B, consumidores sin varsense y sin directorio. */
function montarArea({ pinRancio = null, pinArnesRancio = null } = {}) {
  const area = fs.mkdtempSync(path.join(BASE_TMP, 'quality-sync-'));
  /* Config del área del fixture: la lista de consumidores es lo que declara qué
   * proyectos se validan, así que la escribe el propio fixture (si no, la prueba
   * leería la config privada de quien la ejecute). */
  const cfg = path.join(area, '.config');
  fs.mkdirSync(cfg, { recursive: true });
  const declarados = [
    ...[...FAMILIA_A, ...DEL_ARNES, ...FAMILIA_B, SUELTO].map((nombre) => ({ nombre, ruta: nombre, fase: 'F3' })),
    ...Object.entries(SIN_DIRECTORIO).map(([nombre, ruta]) => ({ nombre, ruta, fase: 'F3' })),
  ];
  fs.writeFileSync(
    path.join(cfg, 'quality-consumidores.json'),
    `${JSON.stringify({ formato: 1, consumidores: declarados }, null, 2)}\n`,
  );
  const s1 = repo(path.join(area, '.quality-tools', 'sentinel'));
  const v1 = repo(path.join(area, '.quality-tools', 'varsense'));
  const s2 = repo(path.join(area, '.quality-tools-harness', 'sentinel'));
  const v2 = repo(path.join(area, '.quality-tools-harness', 'varsense'));

  for (const nombre of FAMILIA_A) {
    const { tools } = manifiesto(area, nombre, { commit: pinRancio === nombre ? s1.slice(0, 11) : s1 });
    tools.sentinel.sourcePath = '../.quality-tools/sentinel';
    tools.sentinel.provisionPath = '../.quality-tools/sentinel';
    if (tools.varsense) {
      tools.varsense.sourcePath = '../.quality-tools/varsense';
      tools.varsense.provisionPath = '../.quality-tools/varsense';
    }
    fs.writeFileSync(path.join(area, nombre, 'quality-tools.json'), `${JSON.stringify({ schemaVersion: 1, tools }, null, 2)}\n`);
  }

  for (const nombre of DEL_ARNES) {
    const rancio = pinArnesRancio === nombre;
    const { tools } = manifiesto(area, nombre, {
      commit: rancio ? s2.slice(0, 11) : s2,
      commitVarsense: nombre === ARNES_CON_VARSENSE ? v2 : null,
    });
    tools.sentinel.sourcePath = '../.quality-tools-harness/sentinel';
    tools.sentinel.provisionPath = '../.quality-tools-harness/sentinel';
    if (tools.varsense) {
      tools.varsense.sourcePath = '../.quality-tools-harness/varsense';
      tools.varsense.provisionPath = '../.quality-tools-harness/varsense';
    }
    fs.writeFileSync(path.join(area, nombre, 'quality-tools.json'), `${JSON.stringify({ schemaVersion: 1, tools }, null, 2)}\n`);
  }

  for (const nombre of FAMILIA_B) {
    const subSentinel = repo(path.join(area, nombre, 'tools', 'sentinel'));
    const subVarsense = repo(path.join(area, nombre, 'tools', 'varsense'));
    const { tools } = manifiesto(area, nombre, { commit: subSentinel, commitVarsense: subVarsense });
    tools.sentinel.sourcePath = 'tools/sentinel';
    tools.sentinel.provisionPath = '.quality-tools/sentinel';
    tools.varsense.sourcePath = 'tools/varsense';
    tools.varsense.provisionPath = '.quality-tools/varsense';
    fs.writeFileSync(path.join(area, nombre, 'quality-tools.json'), `${JSON.stringify({ schemaVersion: 1, tools }, null, 2)}\n`);
  }

  manifiesto(area, SUELTO, { commit: s1 });
  const suelto = JSON.parse(fs.readFileSync(path.join(area, SUELTO, 'quality-tools.json'), 'utf8'));
  suelto.tools.sentinel.sourcePath = '../.quality-tools/sentinel';
  suelto.tools.sentinel.provisionPath = '../.quality-tools/sentinel';
  fs.writeFileSync(path.join(area, SUELTO, 'quality-tools.json'), `${JSON.stringify(suelto, null, 2)}\n`);

  for (const nombre of Object.keys(SIN_DIRECTORIO)) {
    assert.ok(!fs.existsSync(path.join(area, SIN_DIRECTORIO[nombre])), `${nombre} no debe existir en el fixture`);
  }
  return { area, cfg, s1, v1, s2, v2 };
}

function correr(area, cfg) {
  const r = spawnSync(process.execPath, [SYNC, '--json'], {
    cwd: AQUI,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, WS_AREA_ROOT: area, WS_CONFIG_ROOT: cfg },
  });
  return { status: r.status, salida: r.stdout ?? '', texto: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('un área sana sale con 0 problemas (los checkouts limpios no cuentan)', () => {
  const { area, cfg } = montarArea();
  const { status, salida } = correr(area, cfg);
  const j = JSON.parse(salida);
  assert.equal(j.problemas, 0, JSON.stringify(j.consumidores.filter((c) => c.estado !== 'ok'), null, 1));
  assert.equal(status, 0, salida);
  assert.equal(j.checkout_sentinel, undefined, 'un checkout compartido limpio no es un problema');
  assert.equal(j.checkout_varsense, undefined, 'un checkout compartido limpio no es un problema');
});

test('los consumidores del arnés se validan contra su propio checkout', () => {
  const { area, cfg } = montarArea();
  const { salida } = correr(area, cfg);
  const j = JSON.parse(salida);
  for (const nombre of DEL_ARNES) {
    const c = j.consumidores.find((x) => x.nombre === nombre);
    assert.equal(c.sentinel.estado, 'ok', `${nombre}: ${c.sentinel.detalle}`);
    assert.equal(c.sentinel.checkout, 'propio');
  }
});

test('un consumidor que no declara una herramienta no es un problema', () => {
  const { area, cfg } = montarArea();
  const { salida } = correr(area, cfg);
  const j = JSON.parse(salida);
  for (const nombre of [...SIN_VARSENSE]) {
    const c = j.consumidores.find((x) => x.nombre === nombre);
    assert.equal(c.varsense.estado, 'no-declarado', nombre);
    assert.equal(c.estado, 'ok', `${nombre} no puede salir en rojo por una herramienta que no usa`);
  }
});

test('un directorio ausente se reporta aparte, no como desync', () => {
  const { area, cfg } = montarArea();
  const { status, salida } = correr(area, cfg);
  const j = JSON.parse(salida);
  assert.deepEqual(j.sinDirectorio.sort(), Object.keys(SIN_DIRECTORIO).sort());
  assert.equal(status, 0, 'un registro obsoleto no puede dejar la guarda en rojo permanente');
  for (const c of j.consumidores.filter((x) => x.estado === 'sin-directorio')) {
    assert.ok(!c.sentinel && !c.varsense, `${c.nombre}: sin directorio no hay herramientas que validar`);
  }
});

test('un pin rancio contra el checkout compartido sí es desync (y uno solo)', () => {
  const { area, cfg, s1 } = montarArea({ pinRancio: 'sitio-api' });
  const { status, salida } = correr(area, cfg);
  const j = JSON.parse(salida);
  assert.equal(j.problemas, 1, salida);
  assert.equal(status, 1);
  const c = j.consumidores.find((x) => x.nombre === 'sitio-api');
  assert.equal(c.sentinel.estado, 'desync');
  assert.match(c.sentinel.detalle, new RegExp(`compartido ${s1.slice(0, 12)}`));
});

test('un pin rancio contra el checkout del arnés también es desync', () => {
  const { area, cfg, s2 } = montarArea({ pinArnesRancio: 'sistema-legado' });
  const { status, salida } = correr(area, cfg);
  const j = JSON.parse(salida);
  assert.equal(j.problemas, 1, salida);
  assert.equal(status, 1);
  const c = j.consumidores.find((x) => x.nombre === 'sistema-legado');
  assert.equal(c.sentinel.estado, 'desync');
  assert.match(c.sentinel.detalle, new RegExp(`\\.\\./\\.quality-tools-harness/sentinel ${s2.slice(0, 12)}`));
});
