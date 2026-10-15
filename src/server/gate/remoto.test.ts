/* Tests de las funciones puras de remoto.ts (S3.7): citado, rutas, validación y
 * comandos. Sin SSH ni mutagen: eso se prueba en la ejecución real. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comandoAnalisis,
  comandoVersion,
  comillas,
  configRemotaDe,
  modoAnalisisEn,
  rutaRemota,
} from './remoto.js';

const CFG_OK = {
  host: 'dev89',
  dirRemotoBase: '/home/usuario/taller',
  nodeRemoto: '/home/usuario/.local/share/fnm/node-versions/v24.21.0/installation/bin/node',
  sync: { binario: 'C:/Users/usuario/bin/mutagen/mutagen.exe' },
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
  assert.equal(cfg.mutagen, 'C:/Users/usuario/bin/mutagen/mutagen.exe');
});

test('configRemotaDe: rechaza rutas con metacaracteres, relativas o incompletas', () => {
  assert.throws(() => configRemotaDe({ ...CFG_OK, dirRemotoBase: '/home/usuario/taller; rm -rf /' }), /dirRemotoBase/);
  assert.throws(() => configRemotaDe({ ...CFG_OK, nodeRemoto: 'node' }), /nodeRemoto/);
  assert.throws(() => configRemotaDe({ ...CFG_OK, dirRemotoBase: 'home/dev/taller' }), /dirRemotoBase/);
  assert.throws(() => configRemotaDe({ host: 'dev89' }), /faltan/);
});

test('rutaRemota: une base y clave; rechaza claves no seguras', () => {
  const cfg = configRemotaDe(CFG_OK);
  assert.equal(rutaRemota(cfg, 'RESTAURANTE'), '/home/usuario/taller/RESTAURANTE');
  assert.equal(rutaRemota({ ...cfg, dirRemotoBase: '/home/usuario/taller/' }, 'RESTAURANTE'), '/home/usuario/taller/RESTAURANTE');
  assert.throws(() => rutaRemota(cfg, 'a b'), /no válida/);
  assert.throws(() => rutaRemota(cfg, '../x'), /no válida/);
});

test('modoAnalisisEn: dev89 solo con analisisEn exacto; por defecto local', () => {
  const registro = {
    proyectos: [
      { id: 'RESTAURANTE', analisisEn: 'dev89' },
      { id: 'MN-Inmobiliaria' },
      { id: 'otro', analisisEn: 'DEV89' },
    ],
  };
  assert.equal(modoAnalisisEn(registro, 'RESTAURANTE'), 'dev89');
  assert.equal(modoAnalisisEn(registro, 'MN-Inmobiliaria'), 'local');
  assert.equal(modoAnalisisEn(registro, 'otro'), 'local');
  assert.equal(modoAnalisisEn(registro, 'no-existe'), 'local');
  assert.equal(modoAnalisisEn({}, 'RESTAURANTE'), 'local');
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

test('comandoVersion: comprueba el CLI y lee la versión del package.json', () => {
  const cmd = comandoVersion('/usr/bin/node', '/x/cli.js', '/x/package.json');
  assert.equal(
    cmd,
    `test -f '/x/cli.js' && '/usr/bin/node' -p 'require("/x/package.json").version'`,
  );
});
