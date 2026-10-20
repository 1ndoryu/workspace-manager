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
import { prepararReplica, type PuertoRemoto, reposAnidados } from './remoto.js';
import { type ConfigRemota, configRemotaDe, hostTaller, modoAnalisisEn, rutaRemota, rutaRuntimeRemota } from './config.js';
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
  const r = rutaRuntimeRemota(cfg, 'proyecto-a', 'sentinel');
  assert.equal(r, '/srv/taller/_quality-tools/proyecto-a/sentinel');
  assert.ok(!r.startsWith(`${rutaRemota(cfg, 'proyecto-a')}/`), 'no puede colgar de la réplica');
  assert.equal(rutaRuntimeRemota(cfg, 'PROYECTO TASKS', 'varsense'), '/srv/taller/_quality-tools/PROYECTO TASKS/varsense');
  assert.throws(() => rutaRuntimeRemota(cfg, 'a;b', 'sentinel'), /no válida/);
});

/* [por que] Estado del runtime en la 89: `copiar` si falta la marca, el CLI o node_modules. */
test('comandoEstado: pide copiar si la huella no coincide o falta algo, y ok si todo está al día', () => {
  const cmd = comandoEstado({ base: '/srv/taller/_quality-tools/proyecto-a/sentinel', marca: '/srv/taller/_quality-tools/proyecto-a/sentinel/.fuentes-sha', huella: 'abc123', cli: '/srv/taller/_quality-tools/proyecto-a/sentinel/out/cli/index.js' });
  assert.ok(cmd.includes(`!= 'abc123'`), 'compara la marca con la huella');
  assert.ok(cmd.includes(`[ ! -f '/srv/taller/_quality-tools/proyecto-a/sentinel/out/cli/index.js' ]`), 'mira el CLI');
  assert.ok(cmd.includes(`[ ! -d '/srv/taller/_quality-tools/proyecto-a/sentinel/node_modules' ]`), 'mira node_modules');
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
    base: '/srv/taller/_quality-tools/proyecto-a/sentinel',
    npm: '/home/ejemplo/.local/bin/npm',
    nodeDir: '/home/ejemplo/bin',
    huella: 'abc123',
    huellaLock: 'lock999',
    marca: '/srv/taller/_quality-tools/proyecto-a/sentinel/.fuentes-sha',
    cli: '/srv/taller/_quality-tools/proyecto-a/sentinel/out/cli/index.js',
  });
  assert.ok(cmd.includes(`'/home/ejemplo/.local/bin/npm' ci --silent --prefix '/srv/taller/_quality-tools/proyecto-a/sentinel'`), 'npm ci completo, sin --omit');
  assert.ok(!cmd.includes('--omit'), 'compila con devDependencies');
  assert.ok(cmd.includes(`!= 'completo-lock999'`), 'compara el lock con la marca de instalación completa');
  assert.ok(!cmd.includes(`!= 'lock999'`), 'una marca de instalación --omit=dev antigua no vale');
  assert.ok(cmd.includes(`PATH='/home/ejemplo/bin:'"$PATH"`), 'PATH con el node del runtime');
  assert.ok(cmd.includes('|| { tail -n 20'), 'un fallo vuelca el final del log');
  assert.ok(cmd.includes('exit 3') && cmd.includes('exit 4') && cmd.includes('exit 5'), 'cada etapa sale con su código');
  assert.ok(cmd.endsWith("printf '%s' 'abc123' > '/srv/taller/_quality-tools/proyecto-a/sentinel/.fuentes-sha'; echo ok"), 'la marca se escribe tras compilar');
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

/* [por que] Análisis a la 89 por defecto (AGENTS §1). El portátil solo con `analisisEn: "local"`
 * explícito en el registro; cualquier otro valor, incluido el alias antiguo, va a la 89. */
test('modoAnalisisEn: la 89 por defecto; local solo con analisisEn "local"', () => {
  const registro = {
    proyectos: [
      { id: 'sistema-legado', analisisEn: 'taller' },
      { id: 'sitio-api' },
      { id: 'catalogo-web', host: 'taller-ejemplo' },
      { id: 'otro', analisisEn: 'otro-alias' },
      { id: 'portatil', analisisEn: 'local' },
    ],
  };
  assert.equal(modoAnalisisEn(registro, 'sistema-legado'), 'taller');
  assert.equal(modoAnalisisEn(registro, 'sitio-api'), 'taller', 'sin marca: la 89');
  assert.equal(modoAnalisisEn(registro, 'catalogo-web'), 'taller');
  assert.equal(modoAnalisisEn(registro, 'otro'), 'taller', 'un alias ajeno tampoco baja al portátil');
  assert.equal(modoAnalisisEn(registro, 'portatil'), 'local', 'la única excepción explícita');
  assert.equal(modoAnalisisEn(registro, 'no-existe'), 'taller');
  assert.equal(modoAnalisisEn({}, 'sitio-api'), 'taller');
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
  const cmd = comandoMarcasRepos('/srv/taller/proyecto-a', [
    { ruta: 'glory-rs', marca: 'gitdir: ../.git/modules/glory-rs' },
    { ruta: 'vendors/completo', marca: null },
  ]);
  assert.equal(
    cmd,
    "mkdir -p '/srv/taller/proyecto-a/glory-rs' && printf '%s' 'gitdir: ../.git/modules/glory-rs' > '/srv/taller/proyecto-a/glory-rs/.git' && " +
      "mkdir -p '/srv/taller/proyecto-a/vendors/completo/.git' && echo ok",
  );
  assert.equal(comandoMarcasRepos('/x', []), 'echo ok');
});

test('comandoMarcasRepos: cita el contenido para que no ejecute nada', () => {
  const cmd = comandoMarcasRepos('/x', [{ ruta: 'a', marca: '$(rm -rf /)' }]);
  assert.ok(cmd.includes(`'$(rm -rf /)'`), 'el contenido va entre comillas simples');
});

/* [por que] El puerto falso prueba el flujo sin VPS ni sesión de Mutagen: prepararReplica
 * debe vaciar la cola con la clave y el cfg, una sola vez, y devolver la ruta de la réplica. */
test('prepararReplica: vacía la cola por el puerto y devuelve la ruta de la réplica', async () => {
  const cfg: ConfigRemota = { host: 'taller-ejemplo', dirRemotoBase: '/srv/taller-ejemplo', nodeRemoto: '/usr/bin/node', mutagen: 'mutagen', tmpAudit: '/tmp/wm-audit' };
  const llamadas: Array<{ clave: string; cfg: ConfigRemota }> = [];
  const falso: PuertoRemoto = {
    ssh: async () => ({ stdout: '', fallo: null }),
    copiar: async () => {},
    flush: async (clave, cfgRecibida) => {
      llamadas.push({ clave, cfg: cfgRecibida });
    },
  };
  const ruta = await prepararReplica('proyecto-ejemplo', cfg, falso);
  assert.equal(ruta, `${cfg.dirRemotoBase}/proyecto-ejemplo`);
  assert.equal(llamadas.length, 1, 'flush se llama una vez');
  assert.equal(llamadas[0].clave, 'proyecto-ejemplo');
  assert.equal(llamadas[0].cfg, cfg);
});
