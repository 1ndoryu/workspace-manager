/* Tests del arbol que se envia a la 89 para auditar (partes puras, sin ssh).
 * Lo que se prueba aqui es la decision, no el transporte: que archivos viajan por
 * gestor y donde se descomprimen. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESENCIALES, MANIFIESTOS, pathRemoto, raizRemota } from './auditoria-remota.js';

test('cada gestor recibe solo los archivos que necesita para resolver su lockfile', () => {
  assert.ok(ESENCIALES.cargo('lib.rs'));
  assert.ok(ESENCIALES.cargo('Cargo.toml'));
  assert.ok(ESENCIALES.cargo('Cargo.lock'));
  assert.ok(!ESENCIALES.cargo('package.json'));

  assert.ok(ESENCIALES.npm('package.json'));
  assert.ok(ESENCIALES.npm('package-lock.json'));
  assert.ok(ESENCIALES.npm('npm-shrinkwrap.json'));
  assert.ok(!ESENCIALES.npm('Cargo.lock'));
  assert.ok(!ESENCIALES.npm('pnpm-lock.yaml'));

  assert.ok(ESENCIALES.pnpm('package.json'));
  assert.ok(ESENCIALES.pnpm('pnpm-lock.yaml'));
  assert.ok(ESENCIALES.pnpm('pnpm-workspace.yaml'));
  assert.ok(!ESENCIALES.pnpm('package-lock.json'));
});

/* [por que] La huella decide si se reenvia el arbol. Los `.rs` viajan (cargo
 * rechaza un manifiesto cuyo target no existe) pero NO entran en ella: si
 * entraran, guardar un `.rs` reenviaria 3 MB para nada, porque el resultado del
 * audit no depende de ellos. */
test('los .rs viajan pero no cuentan para la huella', () => {
  assert.ok(ESENCIALES.cargo('main.rs'));
  assert.ok(!MANIFIESTOS.cargo('main.rs'));
  assert.ok(MANIFIESTOS.cargo('Cargo.toml'));
  assert.ok(MANIFIESTOS.cargo('Cargo.lock'));
});

test('npm y pnpm no tienen archivos de sobra: todo lo que viaja cuenta', () => {
  for (const nombre of ['package.json', 'package-lock.json', 'pnpm-lock.yaml']) {
    assert.equal(MANIFIESTOS.npm(nombre), ESENCIALES.npm(nombre), `npm/${nombre}`);
    assert.equal(MANIFIESTOS.pnpm(nombre), ESENCIALES.pnpm(nombre), `pnpm/${nombre}`);
  }
});

/* [por que] WANDORIUS tiene npm en frontend/ y cargo en glory-rs/. Con un arbol por
 * proyecto, el segundo `rm -rf` borraria el del primero y el audit siguiente
 * correria sobre un directorio vacio. */
test('cada gestor tiene su propio arbol en la 89', () => {
  const npm = raizRemota('WANDORIUS', 'npm');
  const cargo = raizRemota('WANDORIUS', 'cargo');
  assert.notEqual(npm, cargo);
  assert.ok(npm.endsWith('/WANDORIUS/npm'));
  assert.ok(cargo.endsWith('/WANDORIUS/cargo'));
});

/* [por que] El PATH del ssh no interactivo no trae ni el node de `taller.json` ni
 * cargo, y `posix.dirname` (no `path.dirname`) es lo que evita que en Windows
 * salga con barras invertidas, que el shell de la 89 no entiende. */
test('el PATH remoto es POSIX y depende del gestor', () => {
  const node = '/home/dev/.local/share/fnm/node-versions/v24.21.0/installation/bin/node';
  assert.equal(pathRemoto('cargo', node), '$HOME/.cargo/bin');
  assert.equal(pathRemoto('npm', node), '/home/dev/.local/share/fnm/node-versions/v24.21.0/installation/bin');
  assert.equal(pathRemoto('pnpm', node), pathRemoto('npm', node));
  assert.ok(!pathRemoto('npm', node).includes('\\'));
});
