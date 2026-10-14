import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analizarEscucha,
  argsTunel,
  comandoNpmCi,
  comandoPrecompilar,
  comandoRemotoUp,
  contenidoEnvRemoto,
  diferenciasConteos,
  esEntradaRemota,
  filtrarSqlParaPg16,
  parsearConteos,
  leerUrlBdLocal,
  marcadorTunel,
  pidDeEscucha,
  pidsEscuchandoLocal,
  rutaLogNpmCi,
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
  const rutas = { dirRemoto: '/home/usuario/taller/P', dirLogs: '/home/usuario/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoRemotoUp(config, rutas, 'P', 3001, ['cargo', 'run', '--release']);
  assert.equal(cmd.includes('cm-heavy'), false);
  assert.ok(cmd.includes('/var/tmp/glory-target/P_main'));
  assert.ok(cmd.includes('tmux has-session'));
  assert.ok(cmd.includes('dev-P-3001'));
  assert.ok(cmd.includes('SQLX_OFFLINE=true'));
});

test('comandoRemotoUp: env del registro llega al proceso; nombres no válidos se rechazan', () => {
  const rutas = { dirRemoto: '/home/usuario/taller/P', dirLogs: '/home/usuario/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
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
  const rutas = { dirRemoto: '/home/usuario/taller/P', dirLogs: '/home/usuario/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
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
  const environ = 'PATH=/usr/bin\nPORT=5199\nDATABASE_URL=postgres://x\nHOME=/home/usuario\n';
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
  const rutas = { dirRemoto: '/home/usuario/taller/P', dirLogs: '/home/usuario/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
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

test('comandoPrecompilar: build bajo cm-heavy, mismo target que el arranque, log fuera de la réplica', () => {
  const rutas = { dirRemoto: '/home/usuario/taller/P', dirLogs: '/home/usuario/taller/_logs/P', target: '/var/tmp/glory-target/P_main' };
  const cmd = comandoPrecompilar(config, rutas, 'P', ['cargo', 'build', '--bin', 'x']);
  assert.match(cmd, /cm-heavy.*cargo/);
  assert.ok(cmd.includes('/var/tmp/glory-target/P_main'));
  assert.ok(cmd.includes('/home/usuario/taller/_logs/P/precompilar-P.log'));
  // sqlx compila contra .sqlx/ y no contra la base de la 89 (puede estar vacía): SQLX_OFFLINE va antes del build.
  assert.ok(cmd.includes('SQLX_OFFLINE=true'));
  assert.ok(cmd.indexOf('SQLX_OFFLINE=true') < cmd.indexOf('cm-heavy'));
  assert.equal(cmd.includes('/home/usuario/taller/P/logs'), false);
});

test('comandoNpmCi: marca por sha256 del lock y log por subproyecto fuera de la réplica', () => {
  const cmd = comandoNpmCi('/home/usuario/taller/P', '/home/usuario/taller/_logs/P', 'frontend', 'P');
  assert.ok(cmd.includes('package-lock.json'));
  assert.ok(cmd.includes('npm ci'));
  assert.ok(cmd.includes('node_modules/.taller-lock-sha256'));
  assert.ok(cmd.includes('/home/usuario/taller/_logs/P/npm-ci-P-frontend.log'));
  assert.equal(cmd.includes('/home/usuario/taller/P/logs'), false);
  assert.ok(cmd.includes('fnm/aliases/default/bin'));
  assert.equal(rutaLogNpmCi('/home/usuario/taller/_logs/P', '.', 'P'), '/home/usuario/taller/_logs/P/npm-ci-P-raiz.log');
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

test('diferenciasConteos: solo iguales numéricos cuentan como coincidentes; ausente o no numérico es diferencia', () => {
  const tablas = ['inmuebles', 'fotos', '_sqlx_migrations'];
  const local = parsearConteos('inmuebles=20\nfotos=397\n_sqlx_migrations=34\n');
  assert.deepEqual(diferenciasConteos(local, parsearConteos('inmuebles=20\nfotos=397\n_sqlx_migrations=34\n'), tablas), []);
  assert.deepEqual(diferenciasConteos(local, parsearConteos('inmuebles=0\nfotos=397\n_sqlx_migrations=34\n'), tablas), ['inmuebles: laptop=20, 89=0']);
  assert.deepEqual(diferenciasConteos(local, parsearConteos('inmuebles=20\nfotos=no-existe\n_sqlx_migrations=34\n'), tablas), ['fotos: laptop=397, 89=no-existe']);
  assert.deepEqual(diferenciasConteos(parsearConteos('inmuebles=sin conteo\n'), parsearConteos('inmuebles=sin conteo\n'), ['inmuebles']), ['inmuebles: laptop=sin conteo, 89=sin conteo']);
});
