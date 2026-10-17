/*
 * Prueba del chequeo de versión del CLI provisionado (viñeta 112).
 *
 * El adapter daba por bueno `.quality-tools/<tool>/` solo porque el archivo
 * existía: un CLI viejo pasaba como si fuera el del pin fijado. Ahora compara
 * `--version` con `quality-tools.json.tools.<tool>.version` y recompila si no
 * cuadra. La prueba levanta un consumidor de verdad (repo git, manifiesto,
 * provisión y caché de certificaciones propios) y mira si compila o no.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { escribirCertificacion } from './certificacion.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SETUP = path.join(AQUI, 'quality-setup.mjs');
/* Los temporales del área van a C:\tmp (laptop) o /var/tmp (89), nunca a %TEMP%. */
const BASE_TMP = process.env.QUALITY_TEST_TMP ?? (process.platform === 'win32' ? 'C:\\tmp' : '/var/tmp');

/* [17AA-7] Cada caso monta un consumidor de mentira bajo `BASE_TMP`. Sin
 * borrarlo se quedaba ahí: 228 carpetas `quality-setup-*` medidas el
 * 2026-10-17, la misma fuga que las `quality-sync-*` y parte de por qué medir
 * `C:\tmp` tardaba 18,6 s. Se limpian al terminar la suite. */
const raicesDePrueba = [];
after(() => {
  while (raicesDePrueba.length > 0) fs.rmSync(raicesDePrueba.pop(), { recursive: true, force: true });
});

const VERSION_FIJADA = '0.0.1';
const VERSION_VIEJA = '9.9.9';
const MARCA = 'marca.txt';

function git(cwd, ...args) {
  const resultado = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(resultado.status, 0, `git ${args.join(' ')}: ${resultado.stderr}`);
  return (resultado.stdout ?? '').trim();
}

/* Consumidor de familia B en miniatura: `src/` es el checkout (con su compile
 * marcador) y `prov/cli.js` la provisión cuyo `--version` queremos controlar. */
function montarConsumidor({ versionCli }) {
  const raiz = fs.mkdtempSync(path.join(BASE_TMP, 'quality-setup-'));
  raicesDePrueba.push(raiz);
  const source = path.join(raiz, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture-sentinel',
        version: '0.0.0',
        private: true,
        scripts: { marca: `node -e "require('node:fs').writeFileSync('${MARCA}','compilado')"` },
      },
      null,
      2,
    )}\n`,
  );
  git(source, 'init', '--quiet');
  git(source, 'add', 'package.json');
  git(source, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'fixture');
  const commit = git(source, 'rev-parse', 'HEAD');

  const prov = path.join(raiz, 'prov');
  fs.mkdirSync(prov, { recursive: true });
  if (versionCli !== null) fs.writeFileSync(path.join(prov, 'cli.js'), `console.log('${versionCli}');\n`);

  fs.writeFileSync(
    path.join(raiz, 'quality-tools.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        tools: {
          sentinel: {
            sourcePath: 'src',
            provisionPath: 'prov',
            cli: 'cli.js',
            commit,
            version: VERSION_FIJADA,
            buildScript: 'marca',
            testScript: null,
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const cache = path.join(raiz, 'cache');
  /* La certificación ya está emitida para este commit: sin el chequeo nuevo, el
   * adapter la reutilizaría sin mirar el CLI. */
  escribirCertificacion(
    { tool: 'sentinel', commit, buildScript: 'marca', testScript: null, platform: process.platform, nodeVersion: process.version },
    {},
    { dir: cache },
  );

  return { raiz, source, cache };
}

function setup(raiz, cache) {
  const resultado = spawnSync(process.execPath, [SETUP, '--workspace', raiz], {
    cwd: AQUI,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GLORY_CERT_CACHE: cache },
  });
  return {
    status: typeof resultado.status === 'number' ? resultado.status : 2,
    salida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
    compilo: fs.existsSync(path.join(raiz, 'src', MARCA)),
  };
}

test('un CLI provisionado de otra versión fuerza compile+suite en vez de reutilizar', () => {
  const { raiz, cache } = montarConsumidor({ versionCli: VERSION_VIEJA });
  const { status, salida, compilo } = setup(raiz, cache);
  assert.equal(status, 0, salida);
  assert.match(salida, new RegExp(`el CLI provisionado se declara ${VERSION_VIEJA} y el manifiesto fija ${VERSION_FIJADA}`));
  assert.ok(compilo, 'debe compilar: la provisión no es la del pin');
  assert.ok(!salida.includes('certificación reutilizada'), 'no puede reutilizar la certificación de un CLI ajeno');
});

test('un CLI provisionado con la versión fijada sí reutiliza la certificación', () => {
  const { raiz, cache } = montarConsumidor({ versionCli: VERSION_FIJADA });
  const { status, salida, compilo } = setup(raiz, cache);
  assert.equal(status, 0, salida);
  assert.ok(salida.includes('certificación reutilizada'), salida);
  assert.ok(!compilo, 'no debe compilar: el CLI ya es el del pin');
});

test('sin CLI provisionado se compila (comportamiento que ya existía)', () => {
  const { raiz, cache } = montarConsumidor({ versionCli: null });
  const { status, salida, compilo } = setup(raiz, cache);
  assert.equal(status, 0, salida);
  assert.ok(salida.includes('CLI provisionado ausente'), salida);
  assert.ok(compilo, 'debe compilar: falta la prueba de que el checkout está construido');
});

test('un CLI ilegible cuenta como no al día', () => {
  const { raiz, cache } = montarConsumidor({ versionCli: null });
  fs.writeFileSync(path.join(raiz, 'prov', 'cli.js'), 'process.exit(3);\n');
  const { status, salida, compilo } = setup(raiz, cache);
  assert.equal(status, 0, salida);
  assert.match(salida, /se declara ilegible y el manifiesto fija/);
  assert.ok(compilo, 'un CLI que no responde no puede dar por buena la provisión');
});
