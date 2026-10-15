import { test } from 'node:test';
import assert from 'node:assert/strict';
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
} from './rcargo.mjs';

const config = cargarConfig();

// [14AA-1] El default lo fija taller.json. Desde 2026-10-15 es remoto (la 89 compila; local solo con --local).
test('modo por defecto lo fija taller.json; con remoto configurado, remoto', () => {
  assert.equal(modoEfectivo([], config, 'RESTAURANTE', {}), config.modoPorDefecto);
  assert.equal(modoEfectivo([], { ...config, modoPorDefecto: 'remoto' }, 'RESTAURANTE', {}), 'remoto');
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
    quitarFlagsTaller(['--local', 'test', '--proyecto=RESTAURANTE', '--', '--nocapture', '--remoto', '--dry-run']),
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
  const r = rutasRemotas(config, 'RESTAURANTE', 'feature/x');
  assert.equal(r.dirRemoto, '/home/usuario/taller/RESTAURANTE');
  assert.equal(r.dirLogs, '/home/usuario/taller/_logs/RESTAURANTE');
  assert.equal(r.dirLogs.startsWith(r.dirRemoto), false);
  assert.equal(r.target, '/var/tmp/glory-target/RESTAURANTE_feature-x');
});

test('sesión Mutagen: réplica unidireccional con exclusiones', () => {
  const args = argsCrearSesion(config, 'RESTAURANTE', 'C:\\proyectos\\RESTAURANTE');
  assert.ok(args.includes('one-way-replica'));
  assert.ok(args.includes('.git'));
  assert.ok(args.includes('config/settings.json'));
  assert.equal(args.at(-1), 'dev89:/home/usuario/taller/RESTAURANTE');
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

const cargoToml = '[package]\nname = "glory-pulse"\nversion = "0.1.0"\n\n[[bin]]\nname = "otro"\n';

test('base por rama: paquete con guiones bajos; main/master sin sufijo', () => {
  assert.equal(nombreBaseDatos(cargoToml, 'main'), 'glory_pulse');
  assert.equal(nombreBaseDatos(cargoToml, 'master'), 'glory_pulse');
  assert.equal(nombreBaseDatos(cargoToml, 'feature/Login-2'), 'glory_pulse_feature_login_2');
});

test('base por rama: solo cuenta [package].name, no [[bin]]', () => {
  const sinPackage = '[workspace]\nmembers = []\n\n[[bin]]\nname = "x"\n';
  assert.throws(() => nombreBaseDatos(sinPackage, 'main'), /sin \[package\]\.name/);
});

test('base por rama: rechaza nombres fuera de [a-z0-9_] o de más de 63 caracteres', () => {
  assert.throws(() => nombreBaseDatos(cargoToml, 'x'.repeat(60)), /demasiado largo|no válido/);
  assert.equal(nombreBaseDatos(cargoToml, 'a'.repeat(40)).length, 'glory_pulse_'.length + 40);
});

test('base por proyecto: `basedatos` pisa al paquete y conserva el sufijo de rama', () => {
  assert.equal(nombreBaseDatos(cargoToml, 'main', 'glory_backend_inmobiliaria'), 'glory_backend_inmobiliaria');
  assert.equal(nombreBaseDatos(cargoToml, 'feature/x', 'glory_backend_inmobiliaria'), 'glory_backend_inmobiliaria_feature_x');
  // Sin Cargo.toml válido no hace falta leerlo si la base viene del registro.
  assert.equal(nombreBaseDatos('', 'main', 'glory_backend_inmobiliaria'), 'glory_backend_inmobiliaria');
  assert.throws(() => nombreBaseDatos(cargoToml, 'main', 'Mal-Nombre'), /no válido/);
});

test('URL de la base: usuario por socket, sin contraseña', () => {
  assert.equal(urlBaseRemota(config.bd, 'glory_pulse'), 'postgres://dev@%2Fvar%2Frun%2Fpostgresql/glory_pulse');
});

test('comando de base: crea solo si falta y con paréntesis', () => {
  const cmd = comandoBaseRemota(config.bd, 'glory_pulse_x');
  assert.ok(cmd.startsWith('( psql '));
  // El SQL va entrecomillado para el shell (shQuote): se comprueban las partes, no el texto literal.
  assert.ok(cmd.includes('pg_database WHERE datname='));
  assert.ok(cmd.includes('glory_pulse_x'));
  assert.ok(cmd.includes('CREATE DATABASE "glory_pulse_x"'));
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
