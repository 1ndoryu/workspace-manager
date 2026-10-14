import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  modoEfectivo,
  quitarFlagsTaller,
  shQuote,
  slug,
  rutasRemotas,
  argsCrearSesion,
  construirComandoRemoto,
  cargarConfig,
} from './rcargo.mjs';

const config = cargarConfig();

// [14AA-1] El default lo fija taller.json. Hasta F0 (VPS 89 sin usuario dev) es local,
// para no romper el cargo diario; el paso a remoto es el último de F0/E2E.
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
  assert.equal(r.dirRemoto, '/home/dev/taller/RESTAURANTE');
  assert.equal(r.target, '/var/tmp/glory-target/RESTAURANTE_feature-x');
});

test('sesión Mutagen: réplica unidireccional con exclusiones', () => {
  const args = argsCrearSesion(config, 'RESTAURANTE', 'C:\\proyectos\\RESTAURANTE');
  assert.ok(args.includes('one-way-replica'));
  assert.ok(args.includes('.git'));
  assert.ok(args.includes('config/settings.json'));
  assert.equal(args.at(-1), 'dev89:/home/dev/taller/RESTAURANTE');
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
