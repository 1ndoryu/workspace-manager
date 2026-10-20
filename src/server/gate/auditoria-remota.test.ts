/* Tests del arbol que se envia a la 89 para auditar (partes puras, sin ssh).
 * Lo que se prueba aqui es la decision, no el transporte: que archivos viajan por
 * gestor y donde se descomprimen. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESENCIALES, MANIFIESTOS, pathRemoto, raizRemota } from './auditoria-remota.js';
import { tarReal } from './herramientas/tar.js';

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

/* [por que] portal-central tiene npm en frontend/ y cargo en glory-rs/. Con un arbol por
 * proyecto, el segundo `rm -rf` borraria el del primero y el audit siguiente
 * correria sobre un directorio vacio. */
test('cada gestor tiene su propio arbol en la 89', () => {
  const cfg = { tmpAudit: '/tmp/wm-audit' };
  const npm = raizRemota(cfg, 'portal-central', 'npm');
  const cargo = raizRemota(cfg, 'portal-central', 'cargo');
  assert.notEqual(npm, cargo);
  assert.equal(npm, '/tmp/wm-audit/portal-central/npm');
  assert.equal(cargo, '/tmp/wm-audit/portal-central/cargo');
});

/* [por que] El PATH del ssh no interactivo no trae ni el node de `taller.json` ni
 * cargo, y `posix.dirname` (no `path.dirname`) es lo que evita que en Windows
 * salga con barras invertidas, que el shell de la 89 no entiende. */
test('el PATH remoto es POSIX y depende del gestor', () => {
  const node = '/home/ejemplo/.local/share/fnm/node-versions/v24.21.0/installation/bin/node';
  assert.equal(pathRemoto('cargo', node), '$HOME/.cargo/bin');
  assert.equal(pathRemoto('npm', node), '/home/ejemplo/.local/share/fnm/node-versions/v24.21.0/installation/bin');
  assert.equal(pathRemoto('pnpm', node), pathRemoto('npm', node));
  assert.ok(!pathRemoto('npm', node).includes('\\'));
});

/* [17AA-6] `tarReal` no puede fijar la ruta de Git de esta maquina.
 *
 * Antes eran dos literales de `C:\Program Files\Git`. Un Git instalado en otro
 * sitio (o en Linux) no casaba ninguno y se caia a `tar`, que en Windows es
 * bsdtar — justo el binario que no se ha probado. Estos casos fijan las tres
 * salidas: `WS_TAR` manda, la raiz se deriva del `git` del PATH, y sin `git`
 * se usa el `tar` del PATH. El entorno llega por parametro: no se toca process.env. */
test('tarReal - WS_TAR manda sobre cualquier busqueda', () => {
  assert.equal(tarReal({ WS_TAR: 'C:/ruta/elegida/tar.exe', PATH: '' }), 'C:/ruta/elegida/tar.exe');
});

test('tarReal - deriva la raiz de Git desde el PATH', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'wm-tar-'));
  try {
    /* Un Git de mentira con la forma real: el ejecutable en `bin/` y el `tar`
     * en `usr/bin/`, que es donde lo pone Git para Windows. */
    const bin = join(raiz, 'bin');
    const usrBin = join(raiz, 'usr', 'bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(usrBin, { recursive: true });
    writeFileSync(join(bin, process.platform === 'win32' ? 'git.exe' : 'git'), '');
    writeFileSync(join(usrBin, 'tar.exe'), '');

    assert.equal(tarReal({ PATH: bin }), join(usrBin, 'tar.exe'));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('tarReal - sin git en el PATH cae al tar del PATH', () => {
  const vacio = mkdtempSync(join(tmpdir(), 'wm-tar-vacio-'));
  try {
    assert.equal(tarReal({ PATH: vacio }), 'tar');
  } finally {
    rmSync(vacio, { recursive: true, force: true });
  }
});
