/* Tests de las funciones puras de remoto.ts (S3.7): citado, rutas, validación y
 * comandos. Sin SSH ni mutagen: eso se prueba en la ejecución real. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  comandoAnalisis,
  comandoDeps,
  comandoMarcasRepos,
  comandoSonda,
  comillas,
  configRemotaDe,
  hostTaller,
  huellaLock,
  modoAnalisisEn,
  reposAnidados,
  rutaRemota,
  rutaRuntimeRemota,
} from './remoto.js';

const CFG_OK = {
  host: 'dev89',
  dirRemotoBase: '/home/usuario/taller',
  nodeRemoto: '/home/usuario/.local/share/fnm/node-versions/v24.21.0/installation/bin/node',
  sync: { binario: 'C:/herramientas/mutagen/mutagen.exe' },
};

test('comillas: cita para POSIX y escapa la comilla simple', () => {
  assert.equal(comillas('abc'), "'abc'");
  assert.equal(comillas("a'b"), `'a'\\''b'`);
  assert.equal(comillas('$(rm -rf /)'), "'$(rm -rf /)'");
});

test('configRemotaDe: acepta rutas absolutas simples', () => {
  const cfg = configRemotaDe(CFG_OK);
  assert.equal(cfg.host, 'dev89');
  assert.equal(cfg.dirRemotoBase, '/home/usuario/taller');
  assert.equal(cfg.mutagen, 'C:/herramientas/mutagen/mutagen.exe');
});

test('configRemotaDe: rechaza rutas con metacaracteres, relativas o incompletas', () => {
  assert.throws(() => configRemotaDe({ ...CFG_OK, dirRemotoBase: '/home/usuario/taller; rm -rf /' }), /dirRemotoBase/);
  assert.throws(() => configRemotaDe({ ...CFG_OK, nodeRemoto: 'node' }), /nodeRemoto/);
  assert.throws(() => configRemotaDe({ ...CFG_OK, dirRemotoBase: 'home/dev/taller' }), /dirRemotoBase/);
  assert.throws(() => configRemotaDe({ host: 'dev89' }), /faltan/);
});

test('rutaRemota: une base y clave; rechaza claves no seguras', () => {
  const cfg = configRemotaDe(CFG_OK);
  assert.equal(rutaRemota(cfg, 'sistema-legado'), '/home/usuario/taller/sistema-legado');
  assert.equal(rutaRemota({ ...cfg, dirRemotoBase: '/home/usuario/taller/' }, 'sistema-legado'), '/home/usuario/taller/sistema-legado');
  assert.throws(() => rutaRemota(cfg, 'a b'), /no válida/);
  assert.throws(() => rutaRemota(cfg, '../x'), /no válida/);
});

test('rutaRuntimeRemota: el runtime vive fuera de la réplica, que se vacía al sincronizar', () => {
  const cfg = configRemotaDe(CFG_OK);
  const r = rutaRuntimeRemota(cfg, 'juego-arcade', 'sentinel');
  assert.equal(r, '/home/usuario/taller/_quality-tools/juego-arcade/sentinel');
  assert.ok(!r.startsWith(`${rutaRemota(cfg, 'juego-arcade')}/`), 'no puede colgar de la réplica');
  assert.throws(() => rutaRuntimeRemota(cfg, 'a b', 'sentinel'), /no válida/);
});

test('comandoDeps: reinstala solo si el lock cambió, y falla en claro si npm ci falla', () => {
  const cmd = comandoDeps('/n/bin/npm', '/home/usuario/taller/_quality-tools/juego-arcade/sentinel', 'abc123');
  assert.ok(cmd.includes(`!= 'abc123'`), 'compara contra la huella');
  assert.ok(cmd.includes(`'/n/bin/npm' ci --omit=dev --silent --prefix '/home/usuario/taller/_quality-tools/juego-arcade/sentinel'`));
  assert.ok(cmd.endsWith('|| exit 3; fi; echo ok'), 'un npm ci fallido sale con 3');
});

test('huellaLock: 16 hex del contenido, y "?" si no hay lock', () => {
  /* El lock propio del repo: existe en cualquier clon, sin depender de rutas de
   * esta máquina ni del checkout de las herramientas de calidad. */
  assert.match(huellaLock(join(import.meta.dirname, '..', '..', '..', 'package-lock.json')), /^[0-9a-f]{16}$/);
  assert.equal(huellaLock('C:/no/existe/package-lock.json'), '?');
});

test('modoAnalisisEn: el taller solo con analisisEn exacto; por defecto local', () => {
  const registro = {
    proyectos: [
      { id: 'sistema-legado', analisisEn: 'taller' },
      { id: 'sitio-api' },
      { id: 'otro', analisisEn: 'DEV89' },
    ],
  };
  assert.equal(modoAnalisisEn(registro, 'sistema-legado'), 'taller');
  assert.equal(modoAnalisisEn(registro, 'sitio-api'), 'local');
  assert.equal(modoAnalisisEn(registro, 'otro'), 'local');
  assert.equal(modoAnalisisEn(registro, 'no-existe'), 'local');
  assert.equal(modoAnalisisEn({}, 'sistema-legado'), 'local');
});

/* [por que] El alias del host fue el valor con el que se escribio `analisisEn` antes de
 * que el modo se llamara por su papel: las configuraciones ya hechas tienen que seguir
 * valiendo, pero el alias lo declara taller.json, no el codigo. Sin taller declarado no
 * hay alias que valga (testigo: el mismo valor con otro host es local). */
test('modoAnalisisEn: el alias del taller declarado pide el taller', () => {
  const registro = { proyectos: [{ id: 'juego-arcade', analisisEn: 'dev89' }] };
  assert.equal(modoAnalisisEn(registro, 'juego-arcade', { host: 'dev89' }), 'taller');
  assert.equal(modoAnalisisEn(registro, 'juego-arcade', { host: 'otra-maquina' }), 'local');
  assert.equal(modoAnalisisEn(registro, 'juego-arcade', null), 'local', 'sin taller no hay alias que interpretar');
});

/* Correr en el taller es lo que manda: un proyecto con `host` en el registro se analiza
 * alli aunque `analisisEn` no diga nada. Y `analisisEn` sigue pudiendo forzar los dos
 * lados. */
test('modoAnalisisEn: un proyecto que corre en el taller analiza en el taller', () => {
  const registro = { proyectos: [{ id: 'catalogo-web', host: 'dev89' }, { id: 'sistema-legado', host: 'dev89', analisisEn: 'local' }] };
  const taller = { modoPorDefecto: 'remoto' };
  assert.equal(modoAnalisisEn(registro, 'catalogo-web', taller), 'taller');
  assert.equal(modoAnalisisEn(registro, 'sistema-legado', taller), 'local', 'analisisEn local manda sobre el host');
});

/* [por que] La senal es `host`, no el bloque `proyectos` de taller.json: ese bloque
 * declara la BD del taller y sistema-legado corria alli sin base de datos, asi que su
 * analisis (259 hallazgos) se quedaba en el portatil. */
test('modoAnalisisEn: el bloque de BD del taller no decide donde se analiza', () => {
  const registro = { proyectos: [{ id: 'sistema-legado', host: 'dev89' }, { id: 'SIN-HOST' }] };
  const taller = { modoPorDefecto: 'remoto', proyectos: { 'SIN-HOST': { basedatos: 'x' } } };
  assert.equal(modoAnalisisEn(registro, 'sistema-legado', taller), 'taller', 'corre en la 89 aunque no tenga BD alli');
  assert.equal(modoAnalisisEn(registro, 'SIN-HOST', taller), 'local', 'una BD declarada no basta si no corre alli');
});

/* Sin taller el manager tiene que seguir entero en local: es el caso de un clon recien
 * hecho, y no es un error. */
test('modoAnalisisEn: sin taller, local', () => {
  const registro = { proyectos: [{ id: 'catalogo-web', host: 'dev89' }] };
  assert.equal(modoAnalisisEn(registro, 'catalogo-web', null), 'local');
  assert.equal(modoAnalisisEn(registro, 'catalogo-web', { modoPorDefecto: 'local' }), 'local');
  assert.equal(modoAnalisisEn(registro, 'catalogo-web', {}), 'local', 'taller sin modo por defecto declarado');
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
    env: { GLORY_SENTINEL_SOURCE_PATH: '/home/usuario/taller/R/.quality-tools/sentinel' },
    node: '/usr/bin/node',
    cli: '/home/usuario/taller/R/out/cli/index.js',
    verbo: 'analyze',
    workspace: '/home/usuario/taller/R',
  });
  assert.equal(
    cmd,
    "env GLORY_SENTINEL_SOURCE_PATH='/home/usuario/taller/R/.quality-tools/sentinel' '/usr/bin/node' '/home/usuario/taller/R/out/cli/index.js' analyze --workspace '/home/usuario/taller/R' --format json",
  );
});

test('comandoSonda: comprueba que el CLI quedó copiado, sin leer la versión remota', () => {
  assert.equal(comandoSonda('/x/cli.js'), `test -f '/x/cli.js' && echo ok`);
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
  const cmd = comandoMarcasRepos('/home/usuario/taller/juego-arcade', [
    { ruta: 'glory-rs', marca: 'gitdir: ../.git/modules/glory-rs' },
    { ruta: 'vendors/completo', marca: null },
  ]);
  assert.equal(
    cmd,
    "mkdir -p '/home/usuario/taller/juego-arcade/glory-rs' && printf '%s' 'gitdir: ../.git/modules/glory-rs' > '/home/usuario/taller/juego-arcade/glory-rs/.git' && " +
      "mkdir -p '/home/usuario/taller/juego-arcade/vendors/completo/.git' && echo ok",
  );
  assert.equal(comandoMarcasRepos('/x', []), 'echo ok');
});

test('comandoMarcasRepos: cita el contenido para que no ejecute nada', () => {
  const cmd = comandoMarcasRepos('/x', [{ ruta: 'a', marca: '$(rm -rf /)' }]);
  assert.ok(cmd.includes(`'$(rm -rf /)'`), 'el contenido va entre comillas simples');
});
