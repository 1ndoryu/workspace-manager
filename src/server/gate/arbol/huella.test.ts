/* [13AA-3] La huella del árbol decide si el gate reutiliza el análisis.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/gate/arbol/huella.test.ts */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { huellaArbol } from './huella.js';
import { raizTemporales } from '../../plataforma/temporales.js';

/* AGENTS §0.2: temporales en la raíz de temporales (C:/tmp en Windows), nunca en %TEMP%. */
const RAIZ_TMP = join(raizTemporales(), 'wm-tests');
mkdirSync(RAIZ_TMP, { recursive: true });

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

describe('huellaArbol', () => {
  let dir = '';
  before(() => {
    dir = mkdtempSync(join(RAIZ_TMP, 'wm-huella-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
    writeFileSync(join(dir, 'a.txt'), 'uno');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'base');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('árbol sin cambios: misma huella en llamadas repetidas', async () => {
    assert.equal(await huellaArbol(dir, 'f'), await huellaArbol(dir, 'f'));
  });

  it('cambia con la frescura (HEAD o versión de herramienta)', async () => {
    assert.notEqual(await huellaArbol(dir, 'f1'), await huellaArbol(dir, 'f2'));
  });

  it('cambia al editar un archivo versionado, al crear uno nuevo y al borrarlo', async () => {
    const limpio = await huellaArbol(dir, 'f');
    writeFileSync(join(dir, 'a.txt'), 'dos y mas');
    const editado = await huellaArbol(dir, 'f');
    assert.notEqual(editado, limpio);
    writeFileSync(join(dir, 'b.txt'), 'nuevo');
    const conNuevo = await huellaArbol(dir, 'f');
    assert.notEqual(conNuevo, editado);
    unlinkSync(join(dir, 'b.txt'));
    assert.equal(await huellaArbol(dir, 'f'), editado);
    git(dir, 'checkout', '--', 'a.txt');
    assert.equal(await huellaArbol(dir, 'f'), limpio);
  });

  it('un cambio staged sin commit también cuenta', async () => {
    const limpio = await huellaArbol(dir, 'f');
    writeFileSync(join(dir, 'a.txt'), 'staged');
    git(dir, 'add', 'a.txt');
    assert.notEqual(await huellaArbol(dir, 'f'), limpio);
    git(dir, 'reset', '-q', '--hard');
  });

  it('el mismo tamaño con otro mtime cambia la huella', async () => {
    writeFileSync(join(dir, 'a.txt'), 'tres');
    const antes = await huellaArbol(dir, 'f');
    utimesSync(join(dir, 'a.txt'), new Date(), new Date(Date.now() + 5000));
    assert.notEqual(await huellaArbol(dir, 'f'), antes);
    git(dir, 'checkout', '--', 'a.txt');
  });

  it('fuera de un repo git devuelve null y no lanza', async () => {
    const fuera = mkdtempSync(join(RAIZ_TMP, 'wm-huella-fuera-'));
    try {
      assert.equal(await huellaArbol(fuera, 'f'), null);
    } finally {
      rmSync(fuera, { recursive: true, force: true });
    }
  });
});
