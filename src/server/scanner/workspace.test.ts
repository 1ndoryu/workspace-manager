/* Pruebas del descubrimiento del workspace: ignorados, carpetas que solo agrupan, carpetas sin
 * git y la señal que las hace proyecto. [por que] Usa un directorio temporal sin repos: así no
 * depende de git ni de la máquina, y corre igual en la VPS 89 (AGENTS §8). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { descubrir } from './workspace.js';
import { raizTemporales } from '../plataforma/sistema/temporales.js';

/* Área con: `a` y `hijo1` con manifiesto (proyectos), `grupo` que solo agrupa, `suelta` y
 * `scripts` sin señal (no son proyectos), `ign` ignorada y un fichero suelto. */
function area(): string {
  const raiz = mkdtempSync(join(raizTemporales(), 'wm-descubrir-'));
  mkdirSync(join(raiz, 'a'));
  writeFileSync(join(raiz, 'a', 'package.json'), '{}');
  mkdirSync(join(raiz, 'ign'));
  mkdirSync(join(raiz, 'suelta'));
  mkdirSync(join(raiz, 'scripts'));
  mkdirSync(join(raiz, 'grupo', 'hijo1'), { recursive: true });
  writeFileSync(join(raiz, 'grupo', 'hijo1', 'Cargo.toml'), '');
  mkdirSync(join(raiz, 'grupo', 'ign'));
  writeFileSync(join(raiz, 'archivo.txt'), '');
  return raiz;
}

test('una carpeta sin git es proyecto solo con señal; ignoradas y ficheros quedan fuera', () => {
  const raiz = area();
  try {
    const { carpetas, repos } = descubrir(raiz, new Set(['ign']), new Set());
    assert.deepEqual(carpetas.map((c) => c.id).sort(), ['a']);
    assert.deepEqual(repos, []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('una carpeta recursiva se baja un nivel y deja los hijos con señal con su padre', () => {
  const raiz = area();
  try {
    const { carpetas } = descubrir(raiz, new Set(['ign']), new Set(['grupo']));
    const hijo = carpetas.find((c) => c.id === 'hijo1');
    assert.ok(hijo, 'hijo1 debe aparecer');
    assert.equal(hijo.padre, 'grupo');
    assert.equal(hijo.clave, 'grupo/hijo1');
    assert.equal(carpetas.some((c) => c.id === 'grupo'), false, 'la carpeta que agrupa no es proyecto');
    assert.equal(carpetas.some((c) => c.id === 'ign'), false, 'ignorada también dentro de recursiva');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
