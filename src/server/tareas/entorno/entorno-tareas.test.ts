/* Test del entorno del puente de tareas: archivo privado, prioridad del
 * proceso y recarga por mtime (sin backend ni red). */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {entornoTareas, leerEnvTareas} from './entorno-tareas.js';

function archivo(contenido: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'wm-tareas-env-'));
  const ruta = join(dir, '.tareas-env');
  writeFileSync(ruta, contenido, 'utf8');
  return ruta;
}

describe('leerEnvTareas', () => {
  it('lee las tres claves y descarta comentarios, vacíos y claves ajenas', () => {
    const ruta = archivo(
      [
        '# credenciales del puente',
        'TASKS_BASE_URL=http://127.0.0.1:14190',
        'TASKS_EMAIL=admin@nakomi.studio',
        'TASKS_PASSWORD=secreta',
        'OTRA_CLAVE=no',
        'TASKS_EMAIL_VACIA=',
      ].join('\n'),
    );
    assert.deepEqual(leerEnvTareas(ruta), {
      TASKS_BASE_URL: 'http://127.0.0.1:14190',
      TASKS_EMAIL: 'admin@nakomi.studio',
      TASKS_PASSWORD: 'secreta',
    });
  });

  it('sin archivo devuelve vacío en vez de fallar', () => {
    assert.deepEqual(leerEnvTareas(join(tmpdir(), 'wm-no-existe', '.tareas-env')), {});
  });

  it('recarga cuando el archivo cambia (mtime distinto)', () => {
    const ruta = archivo('TASKS_BASE_URL=http://vieja:1\n');
    assert.equal(leerEnvTareas(ruta).TASKS_BASE_URL, 'http://vieja:1');
    writeFileSync(ruta, 'TASKS_BASE_URL=http://nueva:2\n', 'utf8');
    const futuro = new Date(Date.now() + 2000);
    utimesSync(ruta, futuro, futuro); /* mtime nuevo aunque el reloj vaya rápido */
    assert.equal(leerEnvTareas(ruta).TASKS_BASE_URL, 'http://nueva:2');
  });
});

describe('entornoTareas', () => {
  it('el proceso manda sobre el archivo', () => {
    const ruta = archivo('TASKS_BASE_URL=http://archivo:1\nTASKS_EMAIL=a@b.test\n');
    assert.equal(entornoTareas({TASKS_BASE_URL: 'http://proceso:2'}, ruta).TASKS_BASE_URL, 'http://proceso:2');
  });

  it('un valor vacío del proceso no pisa al del archivo', () => {
    const ruta = archivo('TASKS_BASE_URL=http://archivo:1\n');
    assert.equal(entornoTareas({TASKS_BASE_URL: '   '}, ruta).TASKS_BASE_URL, 'http://archivo:1');
  });

  it('rellena solo lo que falte', () => {
    const ruta = archivo('TASKS_BASE_URL=http://archivo:1\nTASKS_PASSWORD=del-archivo\n');
    assert.deepEqual(entornoTareas({TASKS_EMAIL: 'x@y.test'}, ruta), {
      TASKS_BASE_URL: 'http://archivo:1',
      TASKS_PASSWORD: 'del-archivo',
      TASKS_EMAIL: 'x@y.test',
    });
  });
});
