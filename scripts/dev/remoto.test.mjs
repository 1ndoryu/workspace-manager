import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analizarEscucha,
  argsTunel,
  comandoConstruirFront,
  comandoNpmCi,
  comandoPrecompilar,
  comandoRemotoUp,
  comandoSondaRemota,
  construirFrontRemoto,
  contenidoEnvFrontend,
  contenidoEnvRemoto,
  diferenciasConteos,
  desviosDeConteos,
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
  tunelDePuertosNuestros,
  tunelEsNuestro,
  validarHostRemoto,
  variablesDistintas,
} from './remoto.mjs';

const config = { host: 'dev89', lockWrapper: 'cm-heavy' };
const entrada = {
  id: 'P',
  host: 'dev89',
  puertos: [3001],
  boton: [['cargo', 'run', '--release']],
  precompilar: [['cargo', 'build', '--release']],
};

test('esEntradaRemota: solo con host no vacío', () => {
  assert.equal(esEntradaRemota({}), false);
  assert.equal(esEntradaRemota({ host: '' }), false);
  assert.equal(esEntradaRemota({ host: 'dev89' }), true);
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
  assert.equal(args.at(-1), 'dev89');
});

test('tunelEsNuestro: exige ssh, host y el reenvio del puerto', () => {
  const cmd = `ssh -N -L 127.0.0.1:3001:127.0.0.1:3001 dev89`;
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd }, config, entrada), true);
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd: 'ssh -N -L 127.0.0.1:4000:127.0.0.1:4000 dev89' }, config, entrada), false);
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'node.exe', cmd }, config, entrada), false);
  assert.equal(tunelEsNuestro(null, config, entrada), false);
  assert.deepEqual(marcadorTunel(config, entrada), ['dev89', '127.0.0.1:3001:127.0.0.1:3001']);
});

test('comandoRemotoUp: cargo sin cm-heavy (el candado es solo del build), target propio e idempotente', () => {
  const rutas = { dirRemoto: '/home/dev/taller/P', dirLogs: '/home/dev/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoRemotoUp(config, rutas, 'P', 3001, ['cargo', 'run', '--release']);
  assert.equal(cmd.includes('cm-heavy'), false);
  assert.ok(cmd.includes('/var/tmp/glory-target/P_main'));
  assert.ok(cmd.includes('tmux has-session'));
  assert.ok(cmd.includes('dev-P-3001'));
  assert.ok(cmd.includes('SQLX_OFFLINE=true'));
  // [por que] Un `.cargo/config.toml` con `rustc-wrapper` de Windows rompe el build en la 89 (WANDORIUS).
  assert.ok(cmd.includes('RUSTC_WRAPPER='));
  assert.ok(cmd.indexOf('RUSTC_WRAPPER=') < cmd.indexOf('CARGO_TARGET_DIR='));
});

test('comandoRemotoUp: env del registro llega al proceso; nombres no válidos se rechazan', () => {
  const rutas = { dirRemoto: '/home/dev/taller/P', dirLogs: '/home/dev/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
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
  const rutas = { dirRemoto: '/home/dev/taller/P', dirLogs: '/home/dev/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoRemotoUp(config, rutas, 'P', 3001, ['npm', 'run', 'dev']);
  assert.equal(cmd.includes('cm-heavy'), false);
  assert.ok(cmd.includes('fnm/aliases/default/bin'));
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
  const environ = 'PATH=/usr/bin\nPORT=5199\nDATABASE_URL=postgres://x\nHOME=/home/dev\n';
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
  const rutas = { dirRemoto: '/home/dev/taller/P', dirLogs: '/home/dev/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const conLocales = { ...entrada, puertos: [3110, 5199], puertosLocales: [3210, 5299] };
  const args = argsTunel(config, conLocales);
  assert.ok(args.includes('127.0.0.1:3210:127.0.0.1:3110'));
  assert.ok(args.includes('127.0.0.1:5299:127.0.0.1:5199'));
  assert.equal(args.includes('127.0.0.1:3110:127.0.0.1:3110'), false);
  assert.deepEqual(marcadorTunel(config, conLocales), ['dev89', '127.0.0.1:3210:127.0.0.1:3110', '127.0.0.1:5299:127.0.0.1:5199']);
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd: 'ssh -N -L 127.0.0.1:3210:127.0.0.1:3110 -L 127.0.0.1:5299:127.0.0.1:5199 dev89' }, config, conLocales), true);
  // Túnel de la versión anterior: contiene los dos marcadores nuevos más un reenvío de sobra al 3102.
  assert.equal(tunelEsNuestro({ creado: 1, imagen: 'ssh.exe', cmd: 'ssh -N -L 127.0.0.1:3210:127.0.0.1:3110 -L 127.0.0.1:5299:127.0.0.1:5199 -L 127.0.0.1:3202:127.0.0.1:3102 dev89' }, config, conLocales), false);
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
  assert.match(validarHostRemoto({ host: config.host, puertos: [3001], puertosRemotos: [] }, config), /puertos remotos/);
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

test('comandoPrecompilar: build bajo cm-heavy, mismo target que el arranque, log fuera de la réplica', () => {
  const rutas = { dirRemoto: '/home/dev/taller/P', dirLogs: '/home/dev/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoPrecompilar(config, rutas, 'P', ['cargo', 'build', '--bin', 'x']);
  assert.match(cmd, /cm-heavy.*cargo/);
  assert.ok(cmd.includes('/var/tmp/glory-target/P_main'));
  assert.ok(cmd.includes('/home/dev/taller/_logs/P/precompilar-P.log'));
  // sqlx compila contra .sqlx/ y no contra la base de la 89 (puede estar vacía): SQLX_OFFLINE va antes del build.
  assert.ok(cmd.includes('SQLX_OFFLINE=true'));
  assert.ok(cmd.indexOf('SQLX_OFFLINE=true') < cmd.indexOf('cm-heavy'));
  assert.ok(cmd.indexOf('RUSTC_WRAPPER=') < cmd.indexOf('cm-heavy'));
  assert.equal(cmd.includes('/home/dev/taller/P/logs'), false);
});

test('comandoNpmCi: marca por sha256 del lock y log por subproyecto fuera de la réplica', () => {
  const cmd = comandoNpmCi('/home/dev/taller/P', '/home/dev/taller/_logs/P', 'frontend', 'P');
  assert.ok(cmd.includes('package-lock.json'));
  assert.ok(cmd.includes('npm ci'));
  assert.ok(cmd.includes('node_modules/.taller-lock-sha256'));
  assert.ok(cmd.includes('/home/dev/taller/_logs/P/npm-ci-P-frontend.log'));
  assert.equal(cmd.includes('/home/dev/taller/P/logs'), false);
  assert.ok(cmd.includes('fnm/aliases/default/bin'));
  assert.equal(rutaLogNpmCi('/home/dev/taller/_logs/P', '.', 'P'), '/home/dev/taller/_logs/P/npm-ci-P-raiz.log');
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
  host: 'dev89',
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
  // NAKOMI: los locales difieren de los remotos y el build trae los suyos.
  assert.deepEqual(localesTodos({ puertos: [3103, 5176], puertosLocales: [13103, 15176], build: { puertos: [3103], puertosLocales: [13103] } }), [13103, 15176]);
  assert.deepEqual(localesTodos({ puertos: [3001] }), [3001]);
});

test('tunelDePuertosNuestros: reconoce el túnel huérfano del otro modo, no los ajenos', () => {
  const proc = (cmd, imagen = 'ssh.exe') => ({ creado: 'x', cmd, imagen });
  const locales = [3110, 5199, 20241];
  const viejo = `ssh -N -L 127.0.0.1:3110:127.0.0.1:3110 -L 127.0.0.1:5199:127.0.0.1:5199 -L 127.0.0.1:20241:127.0.0.1:20241 dev89`;
  // Un reenvío de más: `tunelEsNuestro` lo rechaza (solo mira el modo efectivo), este lo acepta.
  assert.equal(tunelEsNuestro(proc(viejo), config, { puertos: [3110, 20241] }), false);
  assert.equal(tunelDePuertosNuestros(proc(viejo), config, locales), true);
  // Ajeno: otro host, otro binario, un puerto local fuera de la lista o sin reenvíos.
  assert.equal(tunelDePuertosNuestros(proc(viejo.replace('dev89', 'otro')), config, locales), false);
  assert.equal(tunelDePuertosNuestros(proc(viejo, 'sshfs.exe'), config, locales), false);
  assert.equal(tunelDePuertosNuestros(proc(viejo.replace('127.0.0.1:5199', '127.0.0.1:9999')), config, locales), false);
  assert.equal(tunelDePuertosNuestros(proc('ssh -N dev89'), config, locales), false);
  assert.equal(tunelDePuertosNuestros(null, config, locales), false);
  // Sin bind explícito (`-L 3110:127.0.0.1:3110`), que es como lo escribe `ssh -f`: el caso real
  // del túnel huérfano de MN, que se quedaba ocupando el 3110 local.
  assert.equal(tunelDePuertosNuestros(proc('ssh -f -N -L 3110:127.0.0.1:3110 dev89'), config, [3110, 20241]), true);
  // Y `remotos` acota el otro extremo: un reenvío a un puerto ajeno al proyecto no es nuestro.
  assert.equal(tunelDePuertosNuestros(proc('ssh -f -N -L 3110:127.0.0.1:3110 dev89'), config, [3110], [20241]), false);
  assert.equal(tunelDePuertosNuestros(proc('ssh -f -N -L 3110:10.0.0.9:3110 dev89'), config, [3110]), false);
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
  const rutas = { dirRemoto: '/home/dev/taller/P', dirLogs: '/home/dev/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoConstruirFront(rutas, 'P', ['npm', '--prefix', 'frontend', 'run', 'build']);
  // [por que] ~200 MB y 11,5 s: bajo cm-heavy no se podría reconstruir el front sin 6 GB libres.
  assert.equal(cmd.includes('cm-heavy'), false);
  assert.equal(cmd.includes('CARGO_TARGET_DIR'), false);
  assert.equal(cmd.includes('SQLX_OFFLINE'), false);
  // `vite build` hornea lo que ve: el env del registro lleva el proxy de dev y no debe llegar.
  assert.equal(cmd.includes('VITE_'), false);
  assert.ok(cmd.includes('/home/dev/taller/P'));
  assert.ok(cmd.includes('/home/dev/taller/_logs/P/construir-front-P.log'));
  assert.equal(cmd.includes('/home/dev/taller/P/logs'), false);
});

test('construirFrontRemoto: sin build.construirFront aborta antes de tocar la 89', async () => {
  const rutas = { dirRemoto: '/home/dev/taller/P', dirLogs: '/home/dev/taller/_logs/P' };
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
