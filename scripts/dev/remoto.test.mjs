import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analizarEscucha,
  argsTunel,
  borrarRegistro,
  comandoConstruirFront,
  comandoNpmCi,
  comandoPrecompilar,
  comandoRemotoUp,
  comandoSondaRemota,
  construirFrontRemoto,
  despacharPermanente,
  contenidoEnvFrontend,
  contenidoEnvRemoto,
  diferenciasConteos,
  desviosDeConteos,
  DIR_SUPERVISAR,
  entradaEfectiva,
  esEntradaRemota,
  localesTodos,
  filtrarSqlParaPg16,
  MODO_POR_DEFECTO,
  modoDe,
  parsearConteos,
  leerUrlBdLocal,
  marcadorTunel,
  pidDeEscucha,
  pidsEscuchandoLocal,
  puertosTodos,
  rutaLogNpmCi,
  rutaRegistro,
  tunelDePuertosNuestros,
  tunelEsNuestro,
  urlsServidas,
  validarHostRemoto,
  variablesDistintas,
} from './remoto.mjs';

const config = { host: 'taller-ejemplo', lockWrapper: 'cm-heavy' };
const entrada = {
  id: 'P',
  host: 'taller-ejemplo',
  puertos: [3001],
  boton: [['cargo', 'run', '--release']],
  precompilar: [['cargo', 'build', '--release']],
};

test('esEntradaRemota: solo con host no vacío', () => {
  assert.equal(esEntradaRemota({}), false);
  assert.equal(esEntradaRemota({ host: '' }), false);
  assert.equal(esEntradaRemota({ host: 'taller-ejemplo' }), true);
});

test('validarHostRemoto rechaza otro host, requiere y puertos protegidos', () => {
  assert.match(validarHostRemoto({ ...entrada, host: 'otro' }, config), /no permitido/);
  assert.match(validarHostRemoto({ ...entrada, requiere: ['x'] }, config), /requiere/);
  assert.match(validarHostRemoto({ ...entrada, puertos: [8787] }, config), /protegidos/);
  assert.equal(validarHostRemoto(entrada, config), null);
});

test('argsTunel: reenvio solo a loopback, fail-closed y sin multiplexar', () => {
  const args = argsTunel(config, entrada);
  assert.ok(args.includes('ExitOnForwardFailure=yes'));
  assert.ok(args.includes('ControlMaster=no'));
  assert.ok(args.includes('ControlPath=none'));
  assert.ok(args.includes('127.0.0.1:3001:127.0.0.1:3001'));
  assert.equal(args.at(-1), 'taller-ejemplo');
});

test('tunelEsNuestro: exige ssh, host y el reenvio del puerto', () => {
  const cmd = `ssh -N -L 127.0.0.1:3001:127.0.0.1:3001 taller-ejemplo`;
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd }, config, entrada), true);
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd: 'ssh -N -L 127.0.0.1:4000:127.0.0.1:4000 taller-ejemplo' }, config, entrada), false);
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'node.exe', cmd }, config, entrada), false);
  assert.equal(tunelEsNuestro(null, config, entrada), false);
  assert.deepEqual(marcadorTunel(config, entrada), ['taller-ejemplo', '127.0.0.1:3001:127.0.0.1:3001']);
});

test('comandoRemotoUp: cargo sin cm-heavy (el candado es solo del build), target propio e idempotente', () => {
  const rutas = { dirRemoto: '/srv/taller/P', dirLogs: '/srv/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoRemotoUp(config, rutas, 'P', 3001, ['cargo', 'run', '--release']);
  assert.equal(cmd.includes('cm-heavy'), false);
  assert.ok(cmd.includes('/var/tmp/glory-target/P_main'));
  assert.ok(cmd.includes('tmux has-session'));
  assert.ok(cmd.includes('dev-P-3001'));
  assert.ok(cmd.includes('SQLX_OFFLINE=true'));
  // [por que] Un `.cargo/config.toml` con `rustc-wrapper` de Windows rompe el build en la 89 (portal-central).
  assert.ok(cmd.includes('RUSTC_WRAPPER='));
  assert.ok(cmd.indexOf('RUSTC_WRAPPER=') < cmd.indexOf('CARGO_TARGET_DIR='));
});

test('comandoRemotoUp: env del registro llega al proceso; nombres no válidos se rechazan', () => {
  const rutas = { dirRemoto: '/srv/taller/P', dirLogs: '/srv/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoRemotoUp(config, rutas, 'P', 3001, ['npm', 'run', 'dev'], { PORT: '3001', VITE_API_TARGET: 'http://127.0.0.1:3001' });
  // Igual que los demás tests de este bloque: el valor va entrecomillado para el shell remoto, así que se comprueban las partes.
  assert.ok(cmd.includes('PORT='));
  assert.ok(cmd.includes('VITE_API_TARGET='));
  assert.ok(cmd.includes('127.0.0.1:3001'));
  assert.ok(cmd.indexOf('PORT=') < cmd.indexOf('CARGO_TARGET_DIR='));
  assert.ok(validarHostRemoto({ host: config.host, puertos: [3001], env: { 'BAD NAME': 'x' } }, config).includes('BAD NAME'));
  assert.equal(validarHostRemoto({ host: config.host, puertos: [3001], env: { PORT: '3001' } }, config), null);
});

test('comandoRemotoUp: comando no cargo no pasa por cm-heavy', () => {
  const rutas = { dirRemoto: '/srv/taller/P', dirLogs: '/srv/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoRemotoUp(config, rutas, 'P', 3001, ['npm', 'run', 'dev']);
  assert.equal(cmd.includes('cm-heavy'), false);
  assert.ok(cmd.includes('fnm/aliases/default/bin'));
});

// --- Supervision (plan-supervision-proyectos-2026-10-20) -----------------------------
// El registro es el contrato entre `Arranque up` y `taller-vigilante.sh`: si cambia el formato,
// el vigilante deja de ver los proyectos y nada avisa. De ahi que se compruebe la ida y la vuelta.

const rutasSup = { dirRemoto: '/srv/taller/P', dirLogs: '/srv/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };

// El contenido va entrecomillado para el shell remoto; se deshace el escapado de `shQuote`
// (una comilla simple dentro se escribe '\'') para quedarse con el texto tal cual.
function registroDe(cmd) {
  const contenido = cmd
    .match(/printf '%s' '(.*)' > /s)[1]
    .replaceAll("'\\''", "'");
  const campos = {};
  for (const linea of contenido.split('\n')) {
    const m = linea.match(/^([A-Z]+)='([A-Za-z0-9+/=]*)'$/);
    if (m) campos[m[1]] = Buffer.from(m[2], 'base64').toString('utf8');
  }
  return { contenido, campos };
}

test('comandoRemotoUp sin supervisar: no graba registro ni mete bucle (el comportamiento de siempre)', () => {
  const cmd = comandoRemotoUp(config, rutasSup, 'P', 3001, ['npm', 'run', 'dev']);
  assert.equal(cmd.includes('supervisar'), false);
  assert.equal(cmd.includes('while :'), false);
  assert.ok(cmd.includes('dev-P-3001'));
});

test('comandoRemotoUp supervisado: bucle de reinicio con espera creciente y registro por sesion', () => {
  const cmd = comandoRemotoUp(config, rutasSup, 'P', 3001, ['npm', 'run', 'dev'], {}, true);
  assert.ok(cmd.includes('n=0; while :; do'));
  // El proceso corre en el bucle y su salida sigue yendo al mismo log de siempre.
  assert.ok(cmd.includes('/srv/taller/_logs/P/dev-up-P-3001.log'));
  // [por que] El registro va DESPUES de crear la sesion: si el arranque falla no debe quedar nada
  // que el vigilante resucite por su cuenta.
  assert.ok(cmd.indexOf('tmux new-session') < cmd.indexOf('printf'));
  assert.ok(cmd.includes(`mkdir -p ${DIR_SUPERVISAR}`));
  assert.ok(cmd.includes('chmod 600'));
  assert.ok(cmd.includes(`${DIR_SUPERVISAR}/dev-P-3001.sh`));
});

test('el registro dice como recrear la sesion: sesion, directorio y el argumento de tmux', () => {
  const cmd = comandoRemotoUp(config, rutasSup, 'P', 3001, ['npm', 'run', 'dev'], {}, true);
  const { campos } = registroDe(cmd);
  assert.equal(campos.SESION, 'dev-P-3001');
  assert.equal(campos.DIR, '/srv/taller/P');
  assert.equal(campos.PROYECTO, 'P');
  assert.equal(campos.PUERTO, '3001');
  // El argumento se guarda YA escapado: el vigilante lo repite tal cual, sin volver a escaparlo.
  assert.ok(campos.ARGUMENTO.startsWith('bash -lc '));
  assert.ok(campos.ARGUMENTO.includes('while :'));
});

test('el vigilante lee el registro con su sed de lista blanca (ida y vuelta del contrato)', () => {
  const cmd = comandoRemotoUp(config, rutasSup, 'P', 3001, ['npm', 'run', 'dev'], {}, true);
  const { contenido } = registroDe(cmd);
  const ruta = join(mkdtempSync(join(tmpdir(), 'vigilante-')), 'dev-P-3001.sh');
  writeFileSync(ruta, contenido);
  // Misma expresion que scripts/remoto/taller-vigilante.sh: solo lineas `CLAVE='base64'`.
  const valor = (clave) => execFileSync('sed', ['-n', `s/^${clave}='\\([A-Za-z0-9+/=]*\\)'$/\\1/p`, ruta]).toString().trim();
  assert.equal(Buffer.from(valor('SESION'), 'base64').toString('utf8'), 'dev-P-3001');
  assert.equal(Buffer.from(valor('DIR'), 'base64').toString('utf8'), '/srv/taller/P');
  assert.ok(Buffer.from(valor('ARGUMENTO'), 'base64').toString('utf8').includes('while :'));
});

test('borrarRegistro: solo el de esa sesion, en el mismo comando que la mata', () => {
  assert.equal(borrarRegistro('P', 3001), `rm -f ${DIR_SUPERVISAR}/dev-P-3001.sh`);
  assert.ok(rutaRegistro('dev-P-3001').endsWith('/dev-P-3001.sh'));
});

test('analizarEscucha: solo loopback no es publico; 0.0.0.0, * y [::] sí', () => {
  const linea = (local) => `LISTEN 0 128 ${local} 0.0.0.0:*`;
  assert.deepEqual(analizarEscucha(linea('127.0.0.1:3001'), 3001), { escucha: true, publicas: [] });
  assert.deepEqual(analizarEscucha(linea('[::1]:3001'), 3001), { escucha: true, publicas: [] });
  assert.deepEqual(analizarEscucha(linea('0.0.0.0:3001'), 3001).publicas, ['0.0.0.0:3001']);
  assert.deepEqual(analizarEscucha(linea('*:3001'), 3001).publicas, ['*:3001']);
  assert.deepEqual(analizarEscucha(linea('[::]:3001'), 3001).publicas, ['[::]:3001']);
});

test('analizarEscucha: no confunde puertos que terminan igual', () => {
  const salida = 'LISTEN 0 128 0.0.0.0:13001 0.0.0.0:*';
  assert.deepEqual(analizarEscucha(salida, 3001), { escucha: false, publicas: [] });
});

test('pidDeEscucha: saca el pid del proceso que escucha en ese puerto, no de otro', () => {
  const salida = [
    'LISTEN 0 511 127.0.0.1:3110 0.0.0.0:* users:(("node",pid=4321,fd=20))',
    'LISTEN 0 511 127.0.0.1:13110 0.0.0.0:* users:(("sshd",pid=99,fd=3))',
    'LISTEN 0 128 127.0.0.1:5199 0.0.0.0:*',
  ].join('\n');
  assert.equal(pidDeEscucha(salida, 3110), 4321);
  assert.equal(pidDeEscucha(salida, 5199), null);
  assert.equal(pidDeEscucha(salida, 3001), null);
});

test('pidsEscuchandoLocal: solo escuchas loopback de nuestros puertos, no conexiones ni escuchas públicas', () => {
  const salida = [
    '  TCP    127.0.0.1:3210         0.0.0.0:0              LISTENING       4321',
    '  TCP    [::1]:3210             [::]:0                 LISTENING       4321',
    '  TCP    127.0.0.1:5299         0.0.0.0:0              LISTENING       4322',
    '  TCP    0.0.0.0:3210           0.0.0.0:0              LISTENING       9999',
    '  TCP    127.0.0.1:3210         127.0.0.1:52000        ESTABLISHED     4321',
    '  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING       7777',
  ].join('\r\n');
  assert.deepEqual(pidsEscuchandoLocal(salida, [3210, 5299]), [4321, 4322]);
  assert.deepEqual(pidsEscuchandoLocal(salida, [3001]), [7777]);
});

test('variablesDistintas: detecta valores distintos o ausentes; ignora el resto del entorno', () => {
  const environ = 'PATH=/usr/bin\nPORT=5199\nDATABASE_URL=postgres://x\nHOME=/home/ejemplo\n';
  assert.deepEqual(variablesDistintas(environ, { PORT: '5199', DATABASE_URL: 'postgres://x' }), []);
  assert.deepEqual(variablesDistintas(environ, { PORT: '3110' }), ['PORT']);
  assert.deepEqual(variablesDistintas(environ, { PORT: '5199', SQLX_OFFLINE: 'true' }), ['SQLX_OFFLINE']);
  // [por que] Sin entorno legible (pid desaparecido) no hay nada que confirmar: todo cuenta como distinto.
  assert.deepEqual(variablesDistintas('', { PORT: '5199' }), ['PORT']);
});

test('validarHostRemoto: botonRemoto con un comando por puerto y cargo exige precompilar', () => {
  const base = { host: config.host, puertos: [3001, 5182] };
  const npm = ['npm', 'run', 'dev'];
  assert.match(validarHostRemoto({ ...base, botonRemoto: [npm] }, config), /un comando por puerto/);
  assert.match(validarHostRemoto({ ...base, botonRemoto: [['cargo', 'run'], npm] }, config), /precompilar/);
  assert.equal(validarHostRemoto({ ...base, botonRemoto: [['cargo', 'run'], npm], precompilar: [['cargo', 'build']] }, config), null);
  assert.equal(validarHostRemoto({ ...base, boton: [npm, npm] }, config), null);
});

test('puertosLocales: el túnel abre el puerto local y deja el remoto; validación fail-closed', () => {
  const rutas = { dirRemoto: '/srv/taller/P', dirLogs: '/srv/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const conLocales = { ...entrada, puertos: [3110, 5199], puertosLocales: [3210, 5299] };
  const args = argsTunel(config, conLocales);
  assert.ok(args.includes('127.0.0.1:3210:127.0.0.1:3110'));
  assert.ok(args.includes('127.0.0.1:5299:127.0.0.1:5199'));
  assert.equal(args.includes('127.0.0.1:3110:127.0.0.1:3110'), false);
  assert.deepEqual(marcadorTunel(config, conLocales), ['taller-ejemplo', '127.0.0.1:3210:127.0.0.1:3110', '127.0.0.1:5299:127.0.0.1:5199']);
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd: 'ssh -N -L 127.0.0.1:3210:127.0.0.1:3110 -L 127.0.0.1:5299:127.0.0.1:5199 taller-ejemplo' }, config, conLocales), true);
  // Túnel de la versión anterior: contiene los dos marcadores nuevos más un reenvío de sobra al 3102.
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd: 'ssh -N -L 127.0.0.1:3210:127.0.0.1:3110 -L 127.0.0.1:5299:127.0.0.1:5199 -L 127.0.0.1:3202:127.0.0.1:3102 taller-ejemplo' }, config, conLocales), false);
  assert.equal(comandoRemotoUp(config, rutas, 'P', 3110, ['npm', 'run', 'dev']).includes('3210'), false);
  assert.match(validarHostRemoto({ ...conLocales, puertosLocales: [3210] }, config), /puertosLocales debe tener/);
  assert.match(validarHostRemoto({ ...conLocales, puertosLocales: [3210, 3210] }, config), /repetidos/);
  assert.match(validarHostRemoto({ ...conLocales, puertosLocales: [3210, 5174] }, config), /protegidos/);
  assert.match(validarHostRemoto({ ...conLocales, puertosLocales: [3210, 80] }, config), /puertosLocales debe tener/);
  assert.equal(validarHostRemoto(conLocales, config), null);
});

// [por que] puertosRemotos: la VPS escucha otros puertos que el dev local (MN: el gateway 3102 no corre en la 89).
test('puertosRemotos: el túnel y la validación usan la lista remota; puertos queda para el dev local', () => {
  const e = {
    ...entrada,
    puertos: [3110, 5199, 3102],
    puertosRemotos: [3110, 5199],
    puertosLocales: [3210, 5299],
    botonRemoto: [['cargo', 'run'], ['npm', 'run', 'dev']],
    precompilar: [['cargo', 'build']],
  };
  const args = argsTunel(config, e);
  assert.ok(args.includes('127.0.0.1:3210:127.0.0.1:3110'));
  assert.ok(args.includes('127.0.0.1:5299:127.0.0.1:5199'));
  assert.equal(args.some((a) => a.includes(':3102')), false);
  assert.equal(validarHostRemoto(e, config), null);
  assert.match(validarHostRemoto({ ...e, puertosLocales: [3210, 5299, 3202] }, config), /puertosLocales debe tener/);
  assert.match(validarHostRemoto({ ...e, botonRemoto: [['cargo', 'run'], ['npm'], ['x']] }, config), /un comando por puerto/);
  assert.match(validarHostRemoto({ ...e, puertosRemotos: [3110, 8787] }, config), /protegidos/);
  // Sin puertos = proyecto sin servicio: válido (la réplica es lo que se sirve).
  assert.equal(validarHostRemoto({ host: config.host, puertos: [], puertosRemotos: [] }, config), null);
  assert.match(validarHostRemoto({ host: config.host, puertos: [3001], puertosRemotos: [80] }, config), /puertos remotos/);
});

test('validarHostRemoto: envRemoto, dependencias, precompilar y cargo sin precompilar', () => {
  const base = { host: config.host, puertos: [3001] };
  assert.match(validarHostRemoto({ ...base, envRemoto: 'x' }, config), /envRemoto/);
  assert.match(validarHostRemoto({ ...base, envRemoto: ['BAD NAME'] }, config), /BAD NAME/);
  assert.equal(validarHostRemoto({ ...base, envRemoto: ['DATABASE_URL'] }, config), null);
  assert.equal(validarHostRemoto({ ...base, envRemoto: 'todo' }, config), null);
  assert.match(validarHostRemoto({ ...base, dependencias: ['../fuera'] }, config), /fuera del proyecto/);
  assert.match(validarHostRemoto({ ...base, dependencias: ['/abs'] }, config), /fuera del proyecto/);
  assert.equal(validarHostRemoto({ ...base, dependencias: ['.', 'frontend'] }, config), null);
  assert.match(validarHostRemoto({ ...base, precompilar: ['cargo build'] }, config), /precompilar debe ser/);
  assert.match(validarHostRemoto({ ...base, boton: [['cargo', 'run']] }, config), /sin precompilar/);
  assert.equal(validarHostRemoto({ ...base, boton: [['cargo', 'run']], precompilar: [['cargo', 'build']] }, config), null);
  assert.equal(validarHostRemoto({ ...base, boton: [['npm', 'run', 'dev']] }, config), null);
});

test('contenidoEnvRemoto: todo copia el archivo, sustituye DATABASE_URL y normaliza CRLF', () => {
  const texto = 'A=1\r\nDATABASE_URL=postgres://local/x\r\nexport B=2\r\n';
  const { contenido, faltan } = contenidoEnvRemoto(texto, 'todo', 'postgres://dev@%2Fvar%2Frun%2Fpostgresql/glory_backend');
  assert.deepEqual(faltan, []);
  assert.equal(contenido, 'A=1\nDATABASE_URL=postgres://dev@%2Fvar%2Frun%2Fpostgresql/glory_backend\nexport B=2\n');
});

test('contenidoEnvRemoto: lista copia solo las claves pedidas y avisa de las que faltan', () => {
  const { contenido, faltan } = contenidoEnvRemoto('A=1\nB=2\nSECRETO=x\n', ['A', 'C'], null);
  assert.deepEqual(faltan, ['C']);
  assert.equal(contenido, 'A=1\n');
});

test('contenidoEnvFrontend: deja solo las claves VITE_* del .env copiado, o nada', () => {
  const { contenido } = contenidoEnvRemoto('DATABASE_URL=x\nVITE_DEV_EMAIL=a@b\nJWT_SECRET=y\nVITE_DEV_PASSWORD=p\n', ['DATABASE_URL', 'VITE_DEV_EMAIL', 'JWT_SECRET', 'VITE_DEV_PASSWORD'], null);
  assert.equal(contenidoEnvFrontend(contenido), 'VITE_DEV_EMAIL=a@b\nVITE_DEV_PASSWORD=p\n');
  assert.equal(contenidoEnvFrontend('JWT_SECRET=y\n'), null);
});

// [18AA-1] La bandera que enciende la auto-entrada en modo build: la añade el manager, no el .env.
test('contenidoEnvFrontend: autologinDev añade la bandera una sola vez', () => {
  assert.equal(contenidoEnvFrontend('VITE_DEV_EMAIL=a@b\n', true), 'VITE_DEV_EMAIL=a@b\nVITE_DEV_AUTOLOGIN=1\n');
  // Sin ninguna clave VITE_* del .env la bandera sola basta: el front igualmente intenta entrar.
  assert.equal(contenidoEnvFrontend('JWT_SECRET=y\n', true), 'VITE_DEV_AUTOLOGIN=1\n');
  assert.equal(contenidoEnvFrontend('VITE_DEV_AUTOLOGIN=1\nVITE_DEV_EMAIL=a@b\n', true), 'VITE_DEV_EMAIL=a@b\nVITE_DEV_AUTOLOGIN=1\n');
});

test('comandoPrecompilar: build bajo cm-heavy, mismo target que el arranque, log fuera de la réplica', () => {
  const rutas = { dirRemoto: '/srv/taller/P', dirLogs: '/srv/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoPrecompilar(config, rutas, 'P', ['cargo', 'build', '--bin', 'x']);
  assert.match(cmd, /cm-heavy.*cargo/);
  assert.ok(cmd.includes('/var/tmp/glory-target/P_main'));
  assert.ok(cmd.includes('/srv/taller/_logs/P/precompilar-P.log'));
  // sqlx compila contra .sqlx/ y no contra la base de la 89 (puede estar vacía): SQLX_OFFLINE va antes del build.
  assert.ok(cmd.includes('SQLX_OFFLINE=true'));
  assert.ok(cmd.indexOf('SQLX_OFFLINE=true') < cmd.indexOf('cm-heavy'));
  assert.ok(cmd.indexOf('RUSTC_WRAPPER=') < cmd.indexOf('cm-heavy'));
  assert.equal(cmd.includes('/srv/taller/P/logs'), false);
});

test('comandoNpmCi: marca por sha256 del lock y log por subproyecto fuera de la réplica', () => {
  const cmd = comandoNpmCi('/srv/taller/P', '/srv/taller/_logs/P', 'frontend', 'P');
  assert.ok(cmd.includes('package-lock.json'));
  assert.ok(cmd.includes('npm ci'));
  assert.ok(cmd.includes('node_modules/.taller-lock-sha256'));
  assert.ok(cmd.includes('/srv/taller/_logs/P/npm-ci-P-frontend.log'));
  assert.equal(cmd.includes('/srv/taller/P/logs'), false);
  assert.ok(cmd.includes('fnm/aliases/default/bin'));
  assert.equal(rutaLogNpmCi('/srv/taller/_logs/P', '.', 'P'), '/srv/taller/_logs/P/npm-ci-P-raiz.log');
});

test('leerUrlBdLocal: acepta loopback y extrae nombre, usuario, host y puerto', () => {
  const r = leerUrlBdLocal('X=1\nDATABASE_URL=postgres://postgres:secreto@localhost:5432/glory_backend_inmobiliaria\n');
  assert.equal(r.nombre, 'glory_backend_inmobiliaria');
  assert.equal(r.usuario, 'postgres');
  assert.equal(r.host, 'localhost');
  assert.equal(r.puerto, 5432);
  assert.equal(r.clave, 'secreto');
  assert.equal(leerUrlBdLocal('DATABASE_URL=postgres://u:c@[::1]:5432/x').host, '::1');
});

test('leerUrlBdLocal: rechaza host no local, falta de DATABASE_URL y formato roto sin mostrar la clave', () => {
  assert.throws(() => leerUrlBdLocal('DATABASE_URL=postgres://u:CLAVE-SECRETA@db.ejemplo.com:5432/x'), (e) => {
    assert.match(e.message, /no a loopback/);
    assert.equal(e.message.includes('CLAVE-SECRETA'), false);
    return true;
  });
  assert.throws(() => leerUrlBdLocal('OTRA=1\n'), /DATABASE_URL no está/);
  assert.throws(() => leerUrlBdLocal('DATABASE_URL=postgres://u:CLAVE-SECRETA@localhost'), (e) => {
    assert.equal(e.message.includes('CLAVE-SECRETA'), false);
    return true;
  });
});

test('filtrarSqlParaPg16: quita las 3 líneas solo-PG18 y deja intacto el resto (incl. SET statement_timeout y CRLF)', () => {
  const sql = 'SET statement_timeout = 0;\nSET transaction_timeout = 0;\n\\restrict abc123\nCREATE TABLE t (a int);\r\n\\unrestrict abc123\n';
  assert.equal(filtrarSqlParaPg16(sql), 'SET statement_timeout = 0;\nCREATE TABLE t (a int);\r\n');
});

test('parsearConteos: lee pares tabla=valor y descarta lo que no lo es', () => {
  const m = parsearConteos('inmuebles=20\nfotos=397\n_sqlx_migrations=34\nbasura sin igual\n');
  assert.equal(m.get('inmuebles'), '20');
  assert.equal(m.get('fotos'), '397');
  assert.equal(m.get('_sqlx_migrations'), '34');
  assert.equal(m.has('basura sin igual'), false);
  assert.equal(parsearConteos('').size, 0);
});

test('desviosDeConteos: solo la 89 con más filas frena la restauración; menos o igual no', () => {
  const tablas = ['inmuebles', 'fotos'];
  const local = parsearConteos('inmuebles=20\nfotos=397\n');
  // El caso real del 2026-10-16: la 89 tenia las fotos subidas por el panel y la laptop no.
  assert.deepEqual(desviosDeConteos(local, parsearConteos('inmuebles=20\nfotos=462\n'), tablas), ['fotos: 89=462 > laptop=397']);
  // La laptop gano filas: refrescar es lo que se pide.
  assert.deepEqual(desviosDeConteos(parsearConteos('inmuebles=20\nfotos=462\n'), local, tablas), []);
  assert.deepEqual(desviosDeConteos(local, local, tablas), []);
  // Sin numero fiable en cualquiera de los lados no se rehusa.
  assert.deepEqual(desviosDeConteos(local, parsearConteos('inmuebles=no-existe\nfotos=sin conteo\n'), tablas), []);
  assert.deepEqual(desviosDeConteos(parsearConteos('inmuebles=sin conteo\nfotos=sin conteo\n'), parsearConteos('inmuebles=20\nfotos=462\n'), tablas), []);
});

test('diferenciasConteos: solo iguales numéricos cuentan como coincidentes; ausente o no numérico es diferencia', () => {
  const tablas = ['inmuebles', 'fotos', '_sqlx_migrations'];
  const local = parsearConteos('inmuebles=20\nfotos=397\n_sqlx_migrations=34\n');
  assert.deepEqual(diferenciasConteos(local, parsearConteos('inmuebles=20\nfotos=397\n_sqlx_migrations=34\n'), tablas), []);
  assert.deepEqual(diferenciasConteos(local, parsearConteos('inmuebles=0\nfotos=397\n_sqlx_migrations=34\n'), tablas), ['inmuebles: laptop=20, 89=0']);
  assert.deepEqual(diferenciasConteos(local, parsearConteos('inmuebles=20\nfotos=no-existe\n_sqlx_migrations=34\n'), tablas), ['fotos: laptop=397, 89=no-existe']);
  assert.deepEqual(diferenciasConteos(parsearConteos('inmuebles=sin conteo\n'), parsearConteos('inmuebles=sin conteo\n'), ['inmuebles']), ['inmuebles: laptop=sin conteo, 89=sin conteo']);
});

// [por que] tunelSsh:false: la VPS expone sus puertos sola (Cloudflare Tunnel); el laptop no reenvía y el probe corre en la 89.
test('tunelSsh: false no reenvía y la sonda va por el loopback de la 89; valores no booleanos y mezclas se rechazan', () => {
  const sinTunel = { ...entrada, puertos: [3110, 5199], puertosRemotos: [3110, 5199], tunelSsh: false };
  assert.equal(validarHostRemoto(sinTunel, config), null);
  assert.match(validarHostRemoto({ ...sinTunel, tunelSsh: 'no' }, config), /tunelSsh debe ser true o false/);
  assert.match(validarHostRemoto({ ...sinTunel, puertosLocales: [3210, 5299] }, config), /puertosLocales no aplica/);
  assert.equal(validarHostRemoto({ ...sinTunel, tunelSsh: true, puertosLocales: [3210, 5299] }, config), null);
  assert.equal(validarHostRemoto({ ...entrada, tunelSsh: true }, config), null);
  const sonda = comandoSondaRemota(3110, '/api/health');
  assert.ok(sonda.includes('curl'));
  assert.ok(sonda.includes("'http://127.0.0.1:3110/api/health'"));
  assert.ok(sonda.includes('%{http_code}'));
});

// --- Modo del proyecto (16AA-18): `build` sirve el front desde el backend, sin vite ---
const fichaBuild = {
  host: 'taller-ejemplo',
  modo: 'build',
  puertos: [3105, 5182],
  boton: [['npm', 'run', 'dev:back'], ['npm', 'run', 'dev:front']],
  precompilar: [['cargo', 'build', '--release']],
  build: {
    puertos: [3105],
    boton: [['cargo', 'run', '--release']],
    construirFront: [['npm', '--prefix', 'frontend', 'run', 'build']],
    healths: [{ puerto: 3105, ruta: '/', marcador: '<div id="root">' }],
  },
};

test('modoDe: sin `modo` el defecto es build; --dev/--build mandan sobre la ficha', () => {
  assert.equal(MODO_POR_DEFECTO, 'build');
  // Ficha con bloque `build` y sin `modo`: build (16AA-18 F8, decidido por la usuaria).
  assert.equal(modoDe(fichaBuild), 'build');
  assert.deepEqual(entradaEfectiva(fichaBuild).puertosRemotos, [3105]);
  // Ficha sin bloque `build`: no hay a qué cambiar, se queda en dev aunque el defecto sea build.
  assert.equal(modoDe(entrada), 'dev');
  assert.equal(entradaEfectiva(entrada), entrada);
  // Las banderas de sesión siguen mandando sobre las dos.
  assert.equal(modoDe(fichaBuild, 'dev'), 'dev');
  assert.equal(modoDe(entrada, 'build'), 'build');
});

test('entradaEfectiva: en dev la entrada vuelve intacta; en build cambia los arrays alineados', () => {
  // La misma referencia, no una copia: en dev no cambia nada de lo que ya hacía el taller.
  assert.equal(entradaEfectiva(entrada), entrada);
  assert.equal(entradaEfectiva(fichaBuild, 'dev'), fichaBuild);
  const ef = entradaEfectiva(fichaBuild);
  assert.deepEqual(ef.puertos, [3105]);
  assert.deepEqual(ef.puertosRemotos, [3105]);
  assert.deepEqual(ef.botonRemoto, [['cargo', 'run', '--release']]);
  assert.deepEqual(ef.healths, fichaBuild.build.healths);
  // Sin `build.puertosLocales` no se inventa túnel; y la ficha original no se toca.
  assert.equal(ef.puertosLocales, undefined);
  assert.deepEqual(fichaBuild.puertos, [3105, 5182]);
});

test('puertosTodos: une los del dev y los del build para parar las sesiones de los dos modos', () => {
  // [por que] Las sesiones tmux se nombran por puerto: si `stop`/`up` solo miraran el modo efectivo,
  // el vite del modo viejo quedaría vivo (150-650 MB) al cambiar de modo.
  assert.deepEqual(puertosTodos(fichaBuild), [3105, 5182]);
  assert.deepEqual(puertosTodos({ puertos: [3001] }), [3001]);
  assert.deepEqual(puertosTodos({ puertosRemotos: [3001, 5183], build: { puertos: [3001] } }), [3001, 5183]);
  // Sin duplicados y sin inventar cuando el bloque no está.
  assert.deepEqual(puertosTodos({ puertos: [3001], build: {} }), [3001]);
});

test('localesTodos: los puertos locales de los dos modos, con la regla de puertosLocalesDe', () => {
  // MN: en dev el vite vive en 5199 y el backend en 3110; en build solo quedan 3110 y el conector.
  assert.deepEqual(localesTodos({ puertosRemotos: [3110, 5199, 20241], build: { puertos: [3110, 20241] } }), [3110, 5199, 20241]);
  // catalogo-web: los locales difieren de los remotos y el build trae los suyos.
  assert.deepEqual(localesTodos({ puertos: [3103, 5176], puertosLocales: [13103, 15176], build: { puertos: [3103], puertosLocales: [13103] } }), [13103, 15176]);
  assert.deepEqual(localesTodos({ puertos: [3001] }), [3001]);
});

test('urlsServidas: en un proyecto remoto imprime el puerto del túnel, no el de la VPS', () => {
  // PROYECTO TASKS: el dev escucha 4190/4191 en la 89 y aquí llega por 14190/14191. Imprimir el
  // remoto daba un enlace muerto (medido el 2026-10-19); en modo build manda el bloque `build`.
  const tareas = {
    host: 'taller-ejemplo',
    modo: 'build',
    dominio: 'tareas.localhost',
    puertos: [4190, 4191],
    puertosLocales: [14190, 14191],
    build: {
      puertos: [4190],
      puertosLocales: [14190],
      healths: [{ puerto: 4190, ruta: '/' }],
    },
  };
  assert.deepEqual(urlsServidas(tareas), ['http://tareas.localhost:14190/']);
  // Sin `healths` vale la lista de puertos del modo, y un puerto sin pareja declarada no se toca.
  assert.deepEqual(urlsServidas({ puertos: [3103], puertosLocales: [13103], healths: [{ puerto: 3103 }, { puerto: 9999 }] }), ['http://127.0.0.1:13103/', 'http://127.0.0.1:9999/']);
  // Un proyecto del portátil no tiene túnel: el local es el remoto.
  assert.deepEqual(urlsServidas({ puertos: [8787, 5175], build: undefined }), ['http://127.0.0.1:8787/', 'http://127.0.0.1:5175/']);
});

test('tunelDePuertosNuestros: reconoce el túnel huérfano del otro modo, no los ajenos', () => {
  const proc = (cmd, imagen = 'ssh.exe') => ({ creado: 'x', cmd, imagen });
  const locales = [3110, 5199, 20241];
  const viejo = `ssh -N -L 127.0.0.1:3110:127.0.0.1:3110 -L 127.0.0.1:5199:127.0.0.1:5199 -L 127.0.0.1:20241:127.0.0.1:20241 taller-ejemplo`;
  // Un reenvío de más: `tunelEsNuestro` lo rechaza (solo mira el modo efectivo), este lo acepta.
  assert.equal(tunelEsNuestro(proc(viejo), config, { puertos: [3110, 20241] }), false);
  assert.equal(tunelDePuertosNuestros(proc(viejo), config, locales), true);
  // Ajeno: otro host, otro binario, un puerto local fuera de la lista o sin reenvíos.
  assert.equal(tunelDePuertosNuestros(proc(viejo.replace('taller-ejemplo', 'otro')), config, locales), false);
  assert.equal(tunelDePuertosNuestros(proc(viejo, 'sshfs.exe'), config, locales), false);
  assert.equal(tunelDePuertosNuestros(proc(viejo.replace('127.0.0.1:5199', '127.0.0.1:9999')), config, locales), false);
  assert.equal(tunelDePuertosNuestros(proc('ssh -N taller-ejemplo'), config, locales), false);
  assert.equal(tunelDePuertosNuestros(null, config, locales), false);
  // Sin bind explícito (`-L 3110:127.0.0.1:3110`), que es como lo escribe `ssh -f`: el caso real
  // del túnel huérfano de MN, que se quedaba ocupando el 3110 local.
  assert.equal(tunelDePuertosNuestros(proc('ssh -f -N -L 3110:127.0.0.1:3110 taller-ejemplo'), config, [3110, 20241]), true);
  // Y `remotos` acota el otro extremo: un reenvío a un puerto ajeno al proyecto no es nuestro.
  assert.equal(tunelDePuertosNuestros(proc('ssh -f -N -L 3110:127.0.0.1:3110 taller-ejemplo'), config, [3110], [20241]), false);
  assert.equal(tunelDePuertosNuestros(proc('ssh -f -N -L 3110:203.0.113.9:3110 taller-ejemplo'), config, [3110]), false);
});

test('validarHostRemoto: en build valida el bloque build, no el del dev', () => {
  assert.equal(validarHostRemoto(fichaBuild, config), null);
  // `--build` sobre una ficha sin bloque: se rechaza, no se cae a los puertos del dev.
  assert.match(validarHostRemoto(entrada, config, 'build'), /sin bloque build/);
  assert.match(validarHostRemoto({ ...entrada, modo: 'build' }, config), /sin bloque build/);
  assert.match(validarHostRemoto({ ...fichaBuild, build: { ...fichaBuild.build, puertos: [] } }, config), /no vacía/);
  assert.match(validarHostRemoto({ ...fichaBuild, build: { ...fichaBuild.build, boton: [] } }, config), /un comando por puerto/);
  assert.match(validarHostRemoto({ ...fichaBuild, modo: 'produccion' }, config), /no valido/);
  // El bloque del dev deja de mirarse en build (y el del build en dev: `--dev` sigue viendo el de siempre).
  assert.equal(validarHostRemoto({ ...fichaBuild, puertos: [8787] }, config), null);
  assert.match(validarHostRemoto({ ...fichaBuild, build: { ...fichaBuild.build, puertos: [8787] } }, config), /protegidos/);
  assert.equal(validarHostRemoto(fichaBuild, config, 'dev'), null);
  // tunelSsh:false no admite locales; en build el bloque los trae y la regla sigue valiendo.
  assert.match(validarHostRemoto({ ...fichaBuild, tunelSsh: false, build: { ...fichaBuild.build, puertosLocales: [13105] } }, config), /no aplica/);
  assert.equal(validarHostRemoto({ ...fichaBuild, build: { ...fichaBuild.build, puertosLocales: [13105] } }, config), null);
});

test('comandoConstruirFront: sin cm-heavy, sin el env del registro, log fuera de la réplica', () => {
  const rutas = { dirRemoto: '/srv/taller/P', dirLogs: '/srv/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoConstruirFront(rutas, 'P', ['npm', '--prefix', 'frontend', 'run', 'build']);
  // [por que] ~200 MB y 11,5 s: bajo cm-heavy no se podría reconstruir el front sin 6 GB libres.
  assert.equal(cmd.includes('cm-heavy'), false);
  assert.equal(cmd.includes('CARGO_TARGET_DIR'), false);
  assert.equal(cmd.includes('SQLX_OFFLINE'), false);
  // `vite build` hornea lo que ve: el env del registro lleva el proxy de dev y no debe llegar.
  assert.equal(cmd.includes('VITE_'), false);
  assert.ok(cmd.includes('/srv/taller/P'));
  assert.ok(cmd.includes('/srv/taller/_logs/P/construir-front-P.log'));
  assert.equal(cmd.includes('/srv/taller/P/logs'), false);
});

test('construirFrontRemoto: sin build.construirFront aborta antes de tocar la 89', async () => {
  const rutas = { dirRemoto: '/srv/taller/P', dirLogs: '/srv/taller/_logs/P' };
  for (const construirFront of [undefined, []]) {
    const ficha = { ...fichaBuild, build: { ...fichaBuild.build, construirFront } };
    const r = await construirFrontRemoto(config, 'P', ficha, rutas);
    assert.equal(r.ok, false);
    assert.match(r.resumen, /construirFront/);
  }
});

test('comandoSondaRemota: con marcador exige que el cuerpo lo contenga; sin él, solo el 200', () => {
  const sin = comandoSondaRemota(3105, '/');
  assert.equal(sin.includes('grep'), false);
  assert.equal(sin.includes('mktemp'), false);
  assert.ok(sin.includes("'http://127.0.0.1:3105/'"));
  const con = comandoSondaRemota(3105, '/', '<div id="root">');
  assert.ok(con.includes('mktemp'));
  assert.ok(con.includes('grep -qF'));
  assert.ok(con.includes("'<div id=\"root\">'"));
  // Sin marcador en el cuerpo la sonda no da 200: en build `/` también lo sirve la API.
  assert.ok(con.includes('%{http_code}'));
  assert.ok(con.includes('echo 000'));
});

// --- Bandera `permanente` (protocolo de estado permanente, 2026-10-21) ----------------
// El tablero enciende la bandera con este subcomando: si grabara la ficha lanzando un `up`,
// encenderla costaria reconstruir el front (minutos) y tocaria la BD de la 89.

function conRegistroTemporal(crudo, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-perm-'));
  const ruta = join(dir, 'registro.json');
  writeFileSync(ruta, JSON.stringify(crudo));
  const salida = [];
  const original = console.log;
  console.log = (t) => salida.push(String(t));
  try {
    return { codigo: fn(ruta), salida, ficha: () => JSON.parse(readFileSync(ruta, 'utf8')).proyectos[0] };
  } finally {
    console.log = original;
  }
}

test('despacharPermanente: enciende la bandera y borra el alias deprecado', () => {
  const r = conRegistroTemporal(
    { proyectos: [{ id: 'P', host: 'h', puertos: [3001], supervisar: true }] },
    (ruta) => despacharPermanente(['P', '--permanente', '--registro', ruta, '--json']),
  );
  assert.equal(r.codigo, 0);
  assert.equal(r.ficha().permanente, true);
  assert.equal('supervisar' in r.ficha(), false);
  assert.match(r.salida[0], /"permanente P: permanente"/);
});

test('despacharPermanente: apaga la bandera y avisa que ya lo estaba', () => {
  const r = conRegistroTemporal(
    { proyectos: [{ id: 'P', host: 'h', puertos: [3001], permanente: false }] },
    (ruta) => despacharPermanente(['P', '--no-permanente', '--registro', ruta]),
  );
  assert.equal(r.codigo, 0);
  assert.equal(r.ficha().permanente, false);
  assert.match(r.salida[0], /ya lo estaba/);
});

test('despacharPermanente: falla cerrado sin valor, sin id o con id ausente del registro', () => {
  // [por que] Sin `--registro` estos dos no tocan el registro real: se cortan antes de leerlo.
  assert.equal(despacharPermanente(['P']), 1);
  assert.equal(despacharPermanente(['--permanente']), 1);
  const r = conRegistroTemporal({ proyectos: [] }, (ruta) =>
    despacharPermanente(['No-Existe', '--permanente', '--registro', ruta]),
  );
  assert.equal(r.codigo, 1);
});
