import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  modoEfectivo,
  quitarFlagsTaller,
  shQuote,
  slug,
  rutasRemotas,
  argsCrearSesion,
  asegurarSesion,
  construirComandoRemoto,
  cargarConfig,
  nombreBaseDatos,
  urlBaseRemota,
  comandoBaseRemota,
  comandoPrepararRama,
  esVps,
  avisoCargoLock,
} from './rcargo.mjs';
import { rutaConfigPrivada } from '../shared/rutas.mjs';

/* [por que] `taller.json` no se versiona (ver config/ejemplos/), asi que el test
 * no puede exigirla: en un clon ajeno usa un fixture con la misma forma. Los
 * asserts comparan contra el propio objeto, de modo que el resultado no cambia. */
const FIXTURE = { modoPorDefecto: 'remoto', proyectos: {} };
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
  assert.equal(r.dirRemoto, '/home/usuario/taller/sistema-legado');
  assert.equal(r.dirLogs, '/home/usuario/taller/_logs/sistema-legado');
  assert.equal(r.dirLogs.startsWith(r.dirRemoto), false);
  assert.equal(r.target, '/var/tmp/glory-target/sistema-legado_feature-x');
});

test('sesión Mutagen: réplica unidireccional con exclusiones', () => {
  const args = argsCrearSesion(config, 'sistema-legado', 'C:\\proyectos\\sistema-legado');
  assert.ok(args.includes('one-way-replica'));
  assert.ok(args.includes('.git'));
  assert.ok(args.includes('config/settings.json'));
  assert.equal(args.at(-1), 'dev89:/home/usuario/taller/sistema-legado');
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
