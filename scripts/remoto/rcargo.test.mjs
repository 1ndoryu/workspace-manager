import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  modoEfectivo,
  quitarFlagsTaller,
  entornoExtra,
  shQuote,
  slug,
  rutasRemotas,
  argsCrearSesion,
  asegurarSesion,
  comandoLocal,
  ignoresDeSesion,
  ignoresAlDia,
  construirComandoRemoto,
  cargarConfig,
  nombreBaseDatos,
  urlBaseRemota,
  comandoBaseRemota,
  comandoPrepararRama,
  esVps,
  avisoCargoLock,
  faltaTargetXwin,
  argsConTargetXwin,
  TARGET_WINDOWS,
} from './rcargo.mjs';
import { rutaConfigPrivada } from '../shared/rutas.mjs';

/* [por que] `taller.json` no se versiona (ver config/ejemplos/), asi que el test
 * no puede exigirla: en un clon ajeno usa un fixture con la misma forma. Los
 * asserts comparan contra el propio objeto, de modo que el resultado no cambia. */
const FIXTURE = { modoPorDefecto: 'remoto', host: 'taller', dirRemotoBase: '/srv/taller', proyectos: {} };
const config = existsSync(rutaConfigPrivada('taller.json')) ? cargarConfig() : FIXTURE;

// [14AA-1] El default lo fija taller.json. Desde 2026-10-15 es remoto (la 89 compila; local solo con --local).
test('modo por defecto lo fija taller.json; con remoto configurado, remoto', () => {
  assert.equal(modoEfectivo([], config, 'sistema-legado', {}), config.modoPorDefecto);
  assert.equal(modoEfectivo([], { ...config, modoPorDefecto: 'remoto' }, 'sistema-legado', {}), 'remoto');
});

test('flags pesan más que variable de entorno y configuración de proyecto', () => {
  const cfg = { ...config, proyectos: { X: { modo: 'remoto' } } };
  assert.equal(modoEfectivo(['--local'], cfg, 'X', { TALLER_MODO: 'remoto' }), 'local');
  assert.equal(modoEfectivo(['--remoto'], cfg, 'X', { TALLER_MODO: 'local' }), 'remoto');
});

test('variable TALLER_MODO pesa más que la configuración de proyecto', () => {
  const cfg = { ...config, proyectos: { X: { modo: 'remoto' } } };
  assert.equal(modoEfectivo([], cfg, 'X', { TALLER_MODO: 'local' }), 'local');
});

test('configuración de proyecto pesa más que el defecto', () => {
  const cfg = { ...config, proyectos: { X: { modo: 'local' } } };
  assert.equal(modoEfectivo([], cfg, 'X', {}), 'local');
  assert.equal(modoEfectivo([], { ...cfg, modoPorDefecto: 'remoto' }, 'Y', {}), 'remoto');
});

test('valores de modo no válidos se ignoran', () => {
  assert.equal(modoEfectivo([], { ...config, modoPorDefecto: 'remoto' }, 'X', { TALLER_MODO: 'nube' }), 'remoto');
});

test('quitarFlagsTaller deja solo los argumentos de cargo', () => {
  assert.deepEqual(
    quitarFlagsTaller(['--local', 'test', '--proyecto=sistema-legado', '--', '--nocapture', '--remoto', '--dry-run']),
    ['test', '--', '--nocapture'],
  );
});

test('quitarFlagsTaller también se lleva el entorno extra', () => {
  assert.deepEqual(
    quitarFlagsTaller(['xwin', 'build', '--env=A=b c', '--prepath=/usr/lib/llvm-18/bin']),
    ['xwin', 'build'],
  );
});

test('entornoExtra: --env entrecomilla solo el valor y --prepath va delante del PATH remoto', () => {
  // El nombre queda fuera de las comillas: si va dentro, bash lee la palabra como un comando.
  assert.deepEqual(
    entornoExtra(['build', '--env=SWAGGER_UI_DOWNLOAD_URL=file:///x.zip', '--prepath=/usr/lib/llvm-18/bin']),
    ["SWAGGER_UI_DOWNLOAD_URL='file:///x.zip'", "PATH='/usr/lib/llvm-18/bin':\"$PATH\""],
  );
  assert.deepEqual(
    entornoExtra(['build', '--env=RUSTFLAGS=-C target-feature=+crt-static']),
    ["RUSTFLAGS='-C target-feature=+crt-static'"],
  );
});

test('entornoExtra: --env sin NOMBRE=valor falla en vez de exportar basura', () => {
  assert.throws(() => entornoExtra(['build', '--env=RUSTFLAGS']), /NOMBRE=valor/);
});

test('comando remoto: el entorno extra viaja delante de cm-heavy cargo', () => {
  const rutas = rutasRemotas(config, 'P', 'main');
  const extra = entornoExtra(['build', '--env=RUSTFLAGS=-C target-feature=+crt-static']);
  // La cadena va entrecomillada para el shell remoto: se compara por partes, no por el texto literal.
  const cadena = construirComandoRemoto(config, rutas, ['build'], null, null, extra)[2];
  const env = cadena.indexOf('target-feature=+crt-static');
  const cargo = cadena.indexOf('cm-heavy cargo');
  assert.ok(env >= 0 && cargo > env, cadena);
});

test('shQuote escapa comillas simples', () => {
  assert.equal(shQuote("a'b"), `'a'\\''b'`);
  assert.equal(shQuote('x y'), "'x y'");
});

test('slug normaliza ramas', () => {
  assert.equal(slug('feature/Login_2'), 'feature-login-2');
  assert.equal(slug('--'), 'main');
});

test('rutas remotas: directorio del proyecto y target por rama', () => {
  const r = rutasRemotas(config, 'sistema-legado', 'feature/x');
  assert.equal(r.dirRemoto, `${config.dirRemotoBase}/sistema-legado`);
  assert.equal(r.dirLogs, `${config.dirRemotoBase}/_logs/sistema-legado`);
  assert.equal(r.dirLogs.startsWith(r.dirRemoto), false);
  assert.equal(r.target, '/var/tmp/glory-target/sistema-legado_feature-x');
});

test('sesión Mutagen: réplica unidireccional con exclusiones', () => {
  const args = argsCrearSesion(config, 'sistema-legado', 'C:\\proyectos\\sistema-legado');
  assert.ok(args.includes('one-way-replica'));
  assert.ok(args.includes('.git'));
  assert.ok(args.includes('config/settings.json'));
  assert.equal(args.at(-1), `${config.host}:${config.dirRemotoBase}/sistema-legado`);
});

/* [10AA-3] La sesión viva no se actualiza sola cuando `sync.ignorar` crece (esta versión de Mutagen
 * no tiene `sync configure`), así que hay que poder leer sus patrones y decidir si recrearla. */
test('ignoresDeSesion lee los patrones de la sesión y calla si no entiende la salida', () => {
  const salida = JSON.stringify([{ name: 'taller-X', ignore: { paths: ['.git', '.quality-tools'] } }]);
  assert.deepEqual(ignoresDeSesion(salida), ['.git', '.quality-tools']);
  assert.equal(ignoresDeSesion(''), null);
  assert.equal(ignoresDeSesion('no es json'), null);
  assert.equal(ignoresDeSesion(JSON.stringify([])), null);
  assert.equal(ignoresDeSesion(JSON.stringify([{ name: 'X' }])), null);
});

test('ignoresAlDia compara como conjunto y detecta el patrón que falta', () => {
  assert.equal(ignoresAlDia(['.git', 'out'], ['out', '.git']), true);
  assert.equal(ignoresAlDia(['.git', 'out'], ['.git']), false);
  assert.equal(ignoresAlDia(['.git'], ['.git', 'out']), false);
  assert.equal(ignoresAlDia(['.git'], null), false);
  assert.equal(ignoresAlDia(null, ['a']), false);
});

// [por que] Orden de la sincronización: el directorio existe antes de crear la sesión, y el envío se fuerza al final.
test('sincronización: directorio antes que la sesión; envío forzado al final', () => {
  const lineas = [];
  const log = console.log;
  console.log = (s) => lineas.push(s);
  let codigo;
  try {
    codigo = asegurarSesion({ config, proyecto: 'X', rutaLocal: 'C:\\x', rutas: rutasRemotas(config, 'X', 'main'), dryRun: true });
  } finally {
    console.log = log;
  }
  const idx = (re) => lineas.findIndex((l) => re.test(l));
  const mkdir = idx(/mkdir -p/);
  const crea = idx(/sync create/);
  const flush = idx(/sync flush/);
  assert.equal(codigo, 0);
  assert.ok(mkdir >= 0 && crea > mkdir && flush > crea, lineas.join('\n'));
});

/* [10AA-3] Dentro de la 89 no hay a dónde hacer ssh: el árbol de trabajo ya es la réplica. Sin esta
 * rama, la etapa de Rust del gate moría con «Could not resolve hostname dev89» desde la propia 89. */
test('comando local: sin ssh, cd al árbol de trabajo y el candado de carga pesada intacto', () => {
  const rutas = rutasRemotas(config, 'P', 'main');
  const orden = comandoLocal(config, rutas, '/srv/taller/P', ['check']);
  assert.doesNotMatch(orden, /\bssh\b/);
  assert.match(orden, /cd '\/srv\/taller\/P'/);
  assert.match(orden, new RegExp(`CARGO_TARGET_DIR='${rutas.target}'`));
  assert.match(orden, new RegExp(`${config.lockWrapper} cargo 'check'`));
});

test('comando local: la base de rama se prepara antes de cargo, igual que en remoto', () => {
  const rutas = rutasRemotas(config, 'P', 'feature/x');
  const orden = comandoLocal(config, rutas, '/srv/taller/P', ['test'], 'pkg_feature-x', { base: 'pkg', semilla: null });
  assert.match(orden, /DATABASE_URL=/);
  assert.ok(orden.indexOf('CREATE DATABASE') < orden.indexOf("cargo 'test'"), orden);
});

test('comando remoto: cargo detrás de cm-heavy y con target propio', () => {
  const rutas = rutasRemotas(config, 'P', 'main');
  const [shell, flag, cadena] = construirComandoRemoto(config, rutas, ['test', '--', 'a b']);
  assert.equal(shell, 'bash');
  assert.equal(flag, '-lc');
  // La cadena va entrecomillada para el shell remoto: se comprueban las partes, no el texto literal.
  assert.ok(cadena.includes('cm-heavy cargo '));
  assert.ok(cadena.includes('/var/tmp/glory-target/P_main'));
  assert.ok(cadena.includes('CARGO_TARGET_DIR='));
});

const cargoToml = '[package]\nname = "agente-tiempo-real"\nversion = "0.1.0"\n\n[[bin]]\nname = "otro"\n';

/* [18AA-8] `cargo xwin` sin `--target` compilaba para Linux en la 89: los artefactos acababan en
 * `release/` y el `.exe` viejo se quedaba donde estaba, con un «Finished» que parecía éxito. */
// La cadena remota entera va entrecomillada para el shell de la 89, así que cada `'` interior sale
// como `'\''`: para buscarla hay que aplicar la misma transformación.
const enCadena = (texto) => texto.replace(/'/g, `'\\''`);
test('xwin: se fuerza el target de Windows; uno explícito manda', () => {
  const rutas = rutasRemotas(config, 'P', 'main');
  const sin = construirComandoRemoto(config, rutas, ['xwin', 'build', '--release'])[2];
  assert.ok(sin.includes(enCadena(`cargo 'xwin' 'build' '--release' '--target' '${TARGET_WINDOWS}'`)), sin);
  // Las dos formas de `--target` cuentan como explícito, y un target distinto no se pisa.
  for (const conTarget of [
    ['xwin', 'build', '--target', 'aarch64-pc-windows-msvc'],
    ['xwin', 'build', '--target=aarch64-pc-windows-msvc'],
  ]) {
    assert.equal(faltaTargetXwin(conTarget), false);
    assert.deepEqual(argsConTargetXwin(conTarget), conTarget);
  }
  // Los subcomandos normales de cargo no se tocan.
  assert.equal(faltaTargetXwin(['test', '--target', 'x']), false);
  assert.deepEqual(argsConTargetXwin(['build', '--release']), ['build', '--release']);
});

test('base por rama: paquete con guiones bajos; main/master sin sufijo', () => {
  assert.equal(nombreBaseDatos(cargoToml, 'main'), 'agente_tiempo_real');
  assert.equal(nombreBaseDatos(cargoToml, 'master'), 'agente_tiempo_real');
  assert.equal(nombreBaseDatos(cargoToml, 'feature/Login-2'), 'agente_tiempo_real_feature_login_2');
});

test('base por rama: solo cuenta [package].name, no [[bin]]', () => {
  const sinPackage = '[workspace]\nmembers = []\n\n[[bin]]\nname = "x"\n';
  assert.throws(() => nombreBaseDatos(sinPackage, 'main'), /sin \[package\]\.name/);
});

test('base por rama: rechaza nombres fuera de [a-z0-9_] o de más de 63 caracteres', () => {
  assert.throws(() => nombreBaseDatos(cargoToml, 'x'.repeat(60)), /demasiado largo|no válido/);
  assert.equal(nombreBaseDatos(cargoToml, 'a'.repeat(40)).length, 'agente_tiempo_real_'.length + 40);
});

test('base por proyecto: `basedatos` pisa al paquete y conserva el sufijo de rama', () => {
  assert.equal(nombreBaseDatos(cargoToml, 'main', 'glory_backend_inmobiliaria'), 'glory_backend_inmobiliaria');
  assert.equal(nombreBaseDatos(cargoToml, 'feature/x', 'glory_backend_inmobiliaria'), 'glory_backend_inmobiliaria_feature_x');
  // Sin Cargo.toml válido no hace falta leerlo si la base viene del registro.
  assert.equal(nombreBaseDatos('', 'main', 'glory_backend_inmobiliaria'), 'glory_backend_inmobiliaria');
  assert.throws(() => nombreBaseDatos(cargoToml, 'main', 'Mal-Nombre'), /no válido/);
});

test('URL de la base: usuario por socket, sin contraseña', () => {
  assert.equal(urlBaseRemota(config.bd, 'agente_tiempo_real'), 'postgres://dev@%2Fvar%2Frun%2Fpostgresql/agente_tiempo_real');
});

test('comando de base: crea solo si falta y con paréntesis', () => {
  const cmd = comandoBaseRemota(config.bd, 'agente_tiempo_real_x');
  assert.ok(cmd.startsWith('( psql '));
  // El SQL va entrecomillado para el shell (shQuote): se comprueban las partes, no el texto literal.
  assert.ok(cmd.includes('pg_database WHERE datname='));
  assert.ok(cmd.includes('agente_tiempo_real_x'));
  assert.ok(cmd.includes('CREATE DATABASE "agente_tiempo_real_x"'));
  assert.ok(cmd.includes('ON_ERROR_STOP=1'));
  assert.ok(cmd.endsWith(' )'));
});

test('comando remoto con base: DATABASE_URL solo cuando se pasa nombre', () => {
  const rutas = rutasRemotas(config, 'P', 'main');
  const sin = construirComandoRemoto(config, rutas, ['check'])[2];
  assert.ok(!sin.includes('DATABASE_URL'));
  assert.ok(!sin.includes('CREATE DATABASE'));
  const con = construirComandoRemoto(config, rutas, ['test'], 'p_main')[2];
  assert.ok(con.includes("DATABASE_URL="));
  assert.ok(con.includes('postgres://dev@'));
  assert.ok(con.includes('CREATE DATABASE "p_main"'));
  assert.ok(con.indexOf('CREATE DATABASE') < con.indexOf('cm-heavy cargo'));
});

// [16AA-9 F3] La base de rama nace vacía: sin clonar el esquema y sembrar, los
// tests de base viva fallan con «no existe la relación …» (el portátil lo
// cubría con run-with-db.mjs, que compila en el portátil y está prohibido).
test('base de rama: clona el esquema de la base de trabajo solo si está vacía', () => {
  const cmd = comandoPrepararRama(config.bd, 'agente_tiempo_real_x', 'agente_tiempo_real', 'scripts/fixtures/seed.sql');
  assert.ok(cmd.startsWith('if [ "$(psql '));
  // El SQL va entrecomillado para el shell (shQuote): se comprueban las partes, no el texto literal.
  assert.ok(cmd.includes('information_schema.tables WHERE table_schema='));
  assert.ok(cmd.includes('pg_dump -h'));
  assert.ok(cmd.includes('--schema-only'));
  assert.ok(cmd.includes("agente_tiempo_real'"), 'la base de trabajo va como origen del clon');
  assert.ok(cmd.includes('-f -'), 'el clon entra por stdin');
  assert.ok(cmd.includes("'scripts/fixtures/seed.sql'"));
  assert.ok(cmd.endsWith('; fi'));
});

test('base de rama: sin semilla declarada solo clona el esquema', () => {
  const cmd = comandoPrepararRama(config.bd, 'agente_tiempo_real_x', 'agente_tiempo_real');
  assert.ok(cmd.includes('pg_dump'));
  assert.ok(!cmd.includes('seed.sql'));
  assert.equal(cmd.match(/-f /g).length, 1);
});

test('comando remoto: la base de rama se prepara antes de cargo, y solo con `preparar`', () => {
  const rutas = rutasRemotas(config, 'P', 'main');
  const con = construirComandoRemoto(config, rutas, ['test'], 'p_x', { base: 'p', semilla: null })[2];
  assert.ok(con.includes('pg_dump'));
  assert.ok(con.indexOf('pg_dump') < con.indexOf('cm-heavy cargo'));
  assert.ok(con.indexOf('CREATE DATABASE') < con.indexOf('pg_dump'));
  // Sin `preparar` (la base de trabajo de `main`) no se toca nada.
  const sin = construirComandoRemoto(config, rutas, ['test'], 'p_main')[2];
  assert.ok(!sin.includes('pg_dump'));
});

// [por que] Mutagen solo existe en el laptop: en la 89 (Linux) el árbol ya es la réplica.
test('esVps: Windows es el laptop, cualquier otra plataforma es la 89', () => {
  assert.equal(esVps('win32'), false);
  assert.equal(esVps('linux'), true);
});

// [por que] Sin Cargo.lock local, la 89 lo borra al sincronizar: el aviso debe salir; con el lock, o sin Cargo.toml, no.
test('aviso de Cargo.lock: Cargo.toml sin lock local; con lock o sin Cargo.toml, nada', () => {
  const con = (archivos) => (ruta) => archivos.includes(path.basename(ruta));
  assert.match(avisoCargoLock('/p', con(['Cargo.toml'])), /Cargo\.lock/);
  assert.equal(avisoCargoLock('/p', con(['Cargo.toml', 'Cargo.lock'])), null);
  assert.equal(avisoCargoLock('/p', con(['package.json'])), null);
});
