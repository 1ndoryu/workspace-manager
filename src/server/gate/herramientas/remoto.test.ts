/* Tests de las funciones puras de remoto.ts y remoto/comandos.ts: citado, rutas,
 * validación y comandos. Sin SSH ni mutagen: eso se prueba en la ejecución real. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RAIZ_REPO } from '../../plataforma/rutas.js';
import {
  comandoAnalisis,
  comandoCompilar,
  comandoDoctor,
  comandoEstado,
  comandoLimpiar,
  comandoMarcasRepos,
  huellaFuentes,
  huellaLock,
} from './remoto/comandos.js';
import { reposAnidados } from './remoto.js';
import { configRemotaDe, hostTaller, modoAnalisisEn, rutaRemota, rutaRuntimeRemota } from './config.js';
import { comillas } from './ssh.js';

const CFG_OK = {
  host: 'taller-ejemplo',
  dirRemotoBase: '/srv/taller',
  nodeRemoto: '/home/ejemplo/.local/share/fnm/node-versions/v24.21.0/installation/bin/node',
  sync: { binario: 'C:/herramientas/mutagen/mutagen.exe' },
};

test('comillas: cita para POSIX y escapa la comilla simple', () => {
  assert.equal(comillas('abc'), "'abc'");
  assert.equal(comillas("a'b"), `'a'\\''b'`);
  assert.equal(comillas('$(rm -rf /)'), "'$(rm -rf /)'");
});

test('configRemotaDe: acepta rutas absolutas simples', () => {
  const cfg = configRemotaDe(CFG_OK);
  assert.equal(cfg.host, 'taller-ejemplo');
  assert.equal(cfg.dirRemotoBase, '/srv/taller');
  assert.equal(cfg.mutagen, 'C:/herramientas/mutagen/mutagen.exe');
});

test('configRemotaDe: rechaza rutas con metacaracteres, relativas o incompletas', () => {
  assert.throws(() => configRemotaDe({ ...CFG_OK, dirRemotoBase: '/srv/taller; rm -rf /' }), /dirRemotoBase/);
  assert.throws(() => configRemotaDe({ ...CFG_OK, nodeRemoto: 'node' }), /nodeRemoto/);
  assert.throws(() => configRemotaDe({ ...CFG_OK, dirRemotoBase: 'home/dev/taller' }), /dirRemotoBase/);
  assert.throws(() => configRemotaDe({ host: 'taller-ejemplo' }), /faltan/);
});

test('rutaRemota: une base y clave; rechaza claves no seguras', () => {
  const cfg = configRemotaDe(CFG_OK);
  assert.equal(rutaRemota(cfg, 'sistema-legado'), '/srv/taller/sistema-legado');
  assert.equal(rutaRemota({ ...cfg, dirRemotoBase: '/srv/taller/' }, 'sistema-legado'), '/srv/taller/sistema-legado');
  assert.equal(rutaRemota(cfg, 'PROYECTO TASKS'), '/srv/taller/PROYECTO TASKS');
  assert.throws(() => rutaRemota(cfg, 'a;b'), /no válida/);
  assert.throws(() => rutaRemota(cfg, '..'), /no válida/);
  assert.throws(() => rutaRemota(cfg, '../x'), /no válida/);
});

test('rutaRuntimeRemota: el runtime vive fuera de la réplica, que se vacía al sincronizar', () => {
  const cfg = configRemotaDe(CFG_OK);
  const r = rutaRuntimeRemota(cfg, 'juego-arcade', 'sentinel');
  assert.equal(r, '/srv/taller/_quality-tools/juego-arcade/sentinel');
  assert.ok(!r.startsWith(`${rutaRemota(cfg, 'juego-arcade')}/`), 'no puede colgar de la réplica');
  assert.equal(rutaRuntimeRemota(cfg, 'PROYECTO TASKS', 'varsense'), '/srv/taller/_quality-tools/PROYECTO TASKS/varsense');
  assert.throws(() => rutaRuntimeRemota(cfg, 'a;b', 'sentinel'), /no válida/);
});

/* [por que] Estado del runtime en la 89: `copiar` si falta la marca, el CLI o node_modules. */
test('comandoEstado: pide copiar si la huella no coincide o falta algo, y ok si todo está al día', () => {
  const cmd = comandoEstado({ base: '/srv/taller/_quality-tools/juego-arcade/sentinel', marca: '/srv/taller/_quality-tools/juego-arcade/sentinel/.fuentes-sha', huella: 'abc123', cli: '/srv/taller/_quality-tools/juego-arcade/sentinel/out/cli/index.js' });
  assert.ok(cmd.includes(`!= 'abc123'`), 'compara la marca con la huella');
  assert.ok(cmd.includes(`[ ! -f '/srv/taller/_quality-tools/juego-arcade/sentinel/out/cli/index.js' ]`), 'mira el CLI');
  assert.ok(cmd.includes(`[ ! -d '/srv/taller/_quality-tools/juego-arcade/sentinel/node_modules' ]`), 'mira node_modules');
  assert.ok(cmd.endsWith('echo copiar; exit 0; fi; echo ok'));
});

test('comandoLimpiar: borra solo las rutas indicadas, citadas', () => {
  assert.equal(comandoLimpiar('/srv/b', ['src', 'out']), "rm -rf '/srv/b/src' '/srv/b/out'");
  assert.equal(comandoLimpiar('/srv/b', ['a b']), "rm -rf '/srv/b/a b'");
});

/* [por que] Compila en la 89 con `npm ci` completo solo si cambia el lock; el PATH lleva
 * el node del runtime; un fallo sale con el log acotado y código distinto por etapa. */
test('comandoCompilar: npm ci solo si cambia el lock, compila con el node de la 89 y falla en claro', () => {
  const cmd = comandoCompilar({
    base: '/srv/taller/_quality-tools/juego-arcade/sentinel',
    npm: '/home/ejemplo/.local/bin/npm',
    nodeDir: '/home/ejemplo/bin',
    huella: 'abc123',
    huellaLock: 'lock999',
    marca: '/srv/taller/_quality-tools/juego-arcade/sentinel/.fuentes-sha',
    cli: '/srv/taller/_quality-tools/juego-arcade/sentinel/out/cli/index.js',
  });
  assert.ok(cmd.includes(`'/home/ejemplo/.local/bin/npm' ci --silent --prefix '/srv/taller/_quality-tools/juego-arcade/sentinel'`), 'npm ci completo, sin --omit');
  assert.ok(!cmd.includes('--omit'), 'compila con devDependencies');
  assert.ok(cmd.includes(`!= 'completo-lock999'`), 'compara el lock con la marca de instalación completa');
  assert.ok(!cmd.includes(`!= 'lock999'`), 'una marca de instalación --omit=dev antigua no vale');
  assert.ok(cmd.includes(`PATH='/home/ejemplo/bin:'"$PATH"`), 'PATH con el node del runtime');
  assert.ok(cmd.includes('|| { tail -n 20'), 'un fallo vuelca el final del log');
  assert.ok(cmd.includes('exit 3') && cmd.includes('exit 4') && cmd.includes('exit 5'), 'cada etapa sale con su código');
  assert.ok(cmd.endsWith("printf '%s' 'abc123' > '/srv/taller/_quality-tools/juego-arcade/sentinel/.fuentes-sha'; echo ok"), 'la marca se escribe tras compilar');
});

test('huellaLock: 16 hex del contenido, y "?" si no hay lock', () => {
  /* El lock propio del repo: existe en cualquier clon, sin depender de rutas de
   * esta máquina ni del checkout de las herramientas de calidad. */
  assert.match(huellaLock(join(RAIZ_REPO, 'package-lock.json')), /^[0-9a-f]{16}$/);
  assert.equal(huellaLock('C:/no/existe/package-lock.json'), '?');
});

/* [por que] La huella decide si se reenvían las fuentes y se recompila en la 89. Debe
 * cambiar con el contenido de las entradas (y de los ficheros anidados), no con el mtime
 * ni con el orden de lectura. */
test('huellaFuentes: cambia con el contenido de las entradas, no con el mtime', () => {
  const base = mkdtempSync(join(tmpdir(), 'wm-fuentes-'));
  try {
    mkdirSync(join(base, 'src', 'cli'), { recursive: true });
    writeFileSync(join(base, 'src', 'cli', 'index.ts'), 'a');
    writeFileSync(join(base, 'package.json'), '{}');
    const entradas = ['src', 'package.json'];
    const primera = huellaFuentes(base, entradas);
    assert.match(primera, /^[0-9a-f]{16}$/);
    assert.equal(huellaFuentes(base, entradas), primera);
    writeFileSync(join(base, 'src', 'cli', 'index.ts'), 'b');
    assert.notEqual(huellaFuentes(base, entradas), primera);
    writeFileSync(join(base, 'src', 'cli', 'index.ts'), 'a');
    assert.equal(huellaFuentes(base, entradas), primera);
    writeFileSync(join(base, 'package.json'), '{"x":1}');
    assert.notEqual(huellaFuentes(base, entradas), primera);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('modoAnalisisEn: el taller solo con analisisEn exacto; por defecto local', () => {
  const registro = {
    proyectos: [
      { id: 'sistema-legado', analisisEn: 'taller' },
      { id: 'sitio-api' },
      { id: 'otro', analisisEn: 'DEV89' },
    ],
  };
  const taller = { host: 'taller-ejemplo' };
  assert.equal(modoAnalisisEn(registro, 'sistema-legado', taller), 'taller');
  assert.equal(modoAnalisisEn(registro, 'sitio-api', taller), 'local');
  assert.equal(modoAnalisisEn(registro, 'otro', taller), 'local');
  assert.equal(modoAnalisisEn(registro, 'no-existe', taller), 'local');
  assert.equal(modoAnalisisEn({}, 'sistema-legado', taller), 'local');
});

/* [por que] Sin taller.json el proyecto del taller sigue siendo del taller: queda en 'taller'
 * y su análisis explica «sin taller configurado». Bajarlo a local lo metía en el portátil
 * (AGENTS §1). */
test('modoAnalisisEn: sin taller, analisisEn "taller" sigue en taller con su motivo', () => {
  const registro = { proyectos: [{ id: 'sistema-legado', analisisEn: 'taller' }] };
  assert.equal(modoAnalisisEn(registro, 'sistema-legado', null), 'taller');
  assert.equal(modoAnalisisEn(registro, 'sistema-legado'), 'taller');
});

/* [por que] El alias del host fue el valor con el que se escribio `analisisEn` antes de
 * que el modo se llamara por su papel: las configuraciones ya hechas tienen que seguir
 * valiendo, pero el alias lo declara taller.json, no el codigo. Sin taller declarado no
 * hay alias que valga (testigo: el mismo valor con otro host es local). */
test('modoAnalisisEn: el alias del taller declarado pide el taller', () => {
  const registro = { proyectos: [{ id: 'juego-arcade', analisisEn: 'taller-ejemplo' }] };
  assert.equal(modoAnalisisEn(registro, 'juego-arcade', { host: 'taller-ejemplo' }), 'taller');
  assert.equal(modoAnalisisEn(registro, 'juego-arcade', { host: 'otra-maquina' }), 'local');
  assert.equal(modoAnalisisEn(registro, 'juego-arcade', null), 'taller', 'sin taller, la marca sigue siendo del taller');
});

/* Correr en el taller es lo que manda: un proyecto con `host` en el registro se analiza
 * alli aunque `analisisEn` no diga nada. Y `analisisEn` sigue pudiendo forzar los dos
 * lados. */
test('modoAnalisisEn: un proyecto que corre en el taller analiza en el taller', () => {
  const registro = { proyectos: [{ id: 'catalogo-web', host: 'taller-ejemplo' }, { id: 'sistema-legado', host: 'taller-ejemplo', analisisEn: 'local' }] };
  const taller = { host: 'taller-ejemplo' };
  assert.equal(modoAnalisisEn(registro, 'catalogo-web', taller), 'taller');
  assert.equal(modoAnalisisEn(registro, 'sistema-legado', taller), 'local', 'analisisEn local manda sobre el host');
});

/* [por que] La senal es `host`, no el bloque `proyectos` de taller.json: ese bloque
 * declara la BD del taller y sistema-legado corria alli sin base de datos, asi que su
 * analisis (259 hallazgos) se quedaba en el portatil. */
test('modoAnalisisEn: el bloque de BD del taller no decide donde se analiza', () => {
  const registro = { proyectos: [{ id: 'sistema-legado', host: 'taller-ejemplo' }, { id: 'SIN-HOST' }] };
  const taller = { host: 'taller-ejemplo', proyectos: { 'SIN-HOST': { basedatos: 'x' } } };
  assert.equal(modoAnalisisEn(registro, 'sistema-legado', taller), 'taller', 'corre en la 89 aunque no tenga BD alli');
  assert.equal(modoAnalisisEn(registro, 'SIN-HOST', taller), 'local', 'una BD declarada no basta si no corre alli');
});

/* Sin taller el manager sigue entero en local para los proyectos sin marca (clon recién
 * hecho, no es un error). Los del taller no bajan al portátil: quedan en 'taller'. */
test('modoAnalisisEn: sin taller, sin marca local y con marca del taller no baja al portátil', () => {
  const registro = { proyectos: [{ id: 'catalogo-web', host: 'taller-ejemplo' }, { id: 'sitio-api' }] };
  assert.equal(modoAnalisisEn(registro, 'catalogo-web', null), 'taller', 'host declarado: del taller');
  assert.equal(modoAnalisisEn(registro, 'sitio-api', null), 'local', 'sin marca: local con o sin taller');
  assert.equal(modoAnalisisEn(registro, 'catalogo-web', { host: 'otra-maquina' }), 'local', 'un host ajeno no es el taller');
  assert.equal(modoAnalisisEn(registro, 'catalogo-web', { host: 'taller-ejemplo' }), 'taller');
});

test('hostTaller: el alias lo declara la config, y sin ella no hay host', () => {
  assert.equal(hostTaller({ host: 'mi-vps' }), 'mi-vps');
  assert.equal(hostTaller({ host: '  mi-vps  ' }), 'mi-vps');
  assert.equal(hostTaller({}), null);
  assert.equal(hostTaller(null), null);
  assert.equal(hostTaller({ host: '' }), null);
  assert.equal(hostTaller({ host: 42 }), null);
});

test('comandoAnalisis: entorno citado, CLI, verbo y workspace', () => {
  const cmd = comandoAnalisis({
    env: { GLORY_SENTINEL_SOURCE_PATH: '/srv/taller/R/.quality-tools/sentinel' },
    node: '/usr/bin/node',
    cli: '/srv/taller/R/out/cli/index.js',
    verbo: 'analyze',
    workspace: '/srv/taller/R',
  });
  assert.equal(
    cmd,
    "env GLORY_SENTINEL_SOURCE_PATH='/srv/taller/R/.quality-tools/sentinel' '/usr/bin/node' '/srv/taller/R/out/cli/index.js' analyze --workspace '/srv/taller/R' --format json",
  );
});

test('comandoDoctor: el doctor no lleva --format, su JSON ya es fijo', () => {
  const cmd = comandoDoctor({
    env: { GLORY_SENTINEL_SOURCE_PATH: '/srv/taller/R/.quality-tools/sentinel' },
    node: '/usr/bin/node',
    cli: '/srv/taller/R/out/cli/index.js',
    workspace: '/srv/taller/R',
  });
  assert.equal(
    cmd,
    "env GLORY_SENTINEL_SOURCE_PATH='/srv/taller/R/.quality-tools/sentinel' '/usr/bin/node' '/srv/taller/R/out/cli/index.js' doctor --json --workspace '/srv/taller/R'",
  );
});

test('reposAnidados: marca de fichero, de directorio y no desciende dentro', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'wm-repos-'));
  try {
    mkdirSync(join(raiz, 'glory-rs', 'frontend'), { recursive: true });
    writeFileSync(join(raiz, 'glory-rs', '.git'), 'gitdir: ../.git/modules/glory-rs\n');
    writeFileSync(join(raiz, 'glory-rs', 'frontend', 'app.ts'), 'export const a = 1;\n');
    mkdirSync(join(raiz, 'vendors', 'completo', '.git'), { recursive: true });
    mkdirSync(join(raiz, 'normal', 'hondo'), { recursive: true });
    mkdirSync(join(raiz, 'node_modules', 'x', '.git'), { recursive: true });

    const repos = reposAnidados(raiz);
    assert.deepEqual(repos, [
      { ruta: 'glory-rs', marca: 'gitdir: ../.git/modules/glory-rs' },
      { ruta: 'vendors/completo', marca: null },
    ]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('comandoMarcasRepos: escribe la marca del fichero y crea la del directorio', () => {
  const cmd = comandoMarcasRepos('/srv/taller/juego-arcade', [
    { ruta: 'glory-rs', marca: 'gitdir: ../.git/modules/glory-rs' },
    { ruta: 'vendors/completo', marca: null },
  ]);
  assert.equal(
    cmd,
    "mkdir -p '/srv/taller/juego-arcade/glory-rs' && printf '%s' 'gitdir: ../.git/modules/glory-rs' > '/srv/taller/juego-arcade/glory-rs/.git' && " +
      "mkdir -p '/srv/taller/juego-arcade/vendors/completo/.git' && echo ok",
  );
  assert.equal(comandoMarcasRepos('/x', []), 'echo ok');
});

test('comandoMarcasRepos: cita el contenido para que no ejecute nada', () => {
  const cmd = comandoMarcasRepos('/x', [{ ruta: 'a', marca: '$(rm -rf /)' }]);
  assert.ok(cmd.includes(`'$(rm -rf /)'`), 'el contenido va entre comillas simples');
});
