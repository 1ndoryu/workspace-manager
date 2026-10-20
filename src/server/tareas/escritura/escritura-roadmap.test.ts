/* Escritura segura del roadmap (20AA-10 F3).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/tareas/escritura/escritura-roadmap.test.ts
 * [por que] Este es el unico modulo del manager que escribe dentro de un proyecto ajeno: si la
 * copia no se verifica o la escritura no es atomica, un fallo aqui cuesta el roadmap de un
 * proyecto. Se prueba contra un directorio temporal, sin tocar ningun proyecto. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TAMANO_MAX_HISTORIAL,
  TOPE_COPIAS,
  apuntarHistorial,
  copiaPrevia,
  dirHistorial,
  dirRespaldos,
  escribirAtomico,
  hashTexto,
  podarCopias,
  type EntradaHistorial,
} from './escritura-roadmap.js';

function taller(): string {
  return mkdtempSync(join(tmpdir(), 'wm-roadmap-'));
}

const entrada = (tarea: string, campo: string): EntradaHistorial => ({
  at: '2026-10-20T12:00:00.000Z',
  tarea,
  origen: 'task',
  campo,
  antes: null,
  despues: 'alta',
  sitio: 'roadmap.md:12',
  autor: 'puente',
});

describe('copiaPrevia', () => {
  it('deja la copia con el mismo contenido y la anota en el indice', () => {
    const raiz = taller();
    const archivo = join(raiz, 'proyecto', 'roadmap.md');
    mkdirSync(join(raiz, 'proyecto'), { recursive: true });
    const texto = '## Pendientes\n\n- [ ] `20AA-1` — **Una.**\n';
    writeFileSync(archivo, texto, 'utf8');

    const { ruta, hash } = copiaPrevia(raiz, 'glory-pulse', archivo, texto, new Date('2026-10-20T12:00:00'));

    assert.equal(hash, hashTexto(texto));
    assert.equal(readFileSync(ruta, 'utf8'), texto);
    assert.match(ruta, /glory-pulse[\\/]20261020-120000-roadmap\.md$/);
    const indice = readFileSync(join(dirRespaldos(raiz), 'indice.ndjson'), 'utf8').trim().split('\n');
    assert.equal(indice.length, 1);
    const linea = JSON.parse(indice[0]) as Record<string, unknown>;
    assert.equal(linea.proyecto, 'glory-pulse');
    assert.equal(linea.copia, ruta);
    assert.equal(linea.hash, hash);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('dos copias del mismo segundo no se pisan entre proyectos', () => {
    const raiz = taller();
    const texto = 'x';
    const a = copiaPrevia(raiz, 'uno', 'uno/roadmap.md', texto, new Date('2026-10-20T12:00:00'));
    const b = copiaPrevia(raiz, 'dos', 'dos/roadmap.md', texto, new Date('2026-10-20T12:00:00'));
    assert.notEqual(a.ruta, b.ruta);
    assert.equal(existsSync(a.ruta) && existsSync(b.ruta), true);
    rmSync(raiz, { recursive: true, force: true });
  });
});

describe('podarCopias', () => {
  it('deja las ultimas y no toca lo que no es una copia', () => {
    const carpeta = taller();
    for (let i = 1; i <= TOPE_COPIAS + 3; i += 1) {
      const sello = `202610${String(i).padStart(2, '0')}-120000`;
      writeFileSync(join(carpeta, `${sello}-roadmap.md`), 'x', 'utf8');
    }
    writeFileSync(join(carpeta, 'notas.txt'), 'x', 'utf8');

    podarCopias(carpeta);

    const copias = readdirSync(carpeta).filter((n) => n.endsWith('-roadmap.md')).sort();
    assert.equal(copias.length, TOPE_COPIAS);
    assert.equal(copias[0], '20261004-120000-roadmap.md');
    assert.equal(existsSync(join(carpeta, 'notas.txt')), true);
    rmSync(carpeta, { recursive: true, force: true });
  });
});

describe('apuntarHistorial', () => {
  it('una linea por cambio, en el archivo del proyecto', () => {
    const raiz = taller();
    const archivo = apuntarHistorial(raiz, 'glory-pulse', [entrada('20AA-1', 'prioridad'), entrada('20AA-2', 'texto')]);
    assert.equal(archivo, join(dirHistorial(raiz), 'glory-pulse.ndjson'));
    const lineas = readFileSync(archivo, 'utf8').trim().split('\n');
    assert.equal(lineas.length, 2);
    assert.deepEqual(JSON.parse(lineas[0]), entrada('20AA-1', 'prioridad'));
    rmSync(raiz, { recursive: true, force: true });
  });

  it('rota a un unico `.1` cuando pasa del tope', () => {
    const raiz = taller();
    const carpeta = dirHistorial(raiz);
    mkdirSync(carpeta, { recursive: true });
    const archivo = join(carpeta, 'glory-pulse.ndjson');
    writeFileSync(archivo, 'x'.repeat(TAMANO_MAX_HISTORIAL + 1), 'utf8');

    apuntarHistorial(raiz, 'glory-pulse', [entrada('20AA-1', 'prioridad')]);

    assert.equal(statSync(`${archivo}.1`).size, TAMANO_MAX_HISTORIAL + 1);
    assert.equal(readFileSync(archivo, 'utf8').trim().split('\n').length, 1);
    rmSync(raiz, { recursive: true, force: true });
  });
});

describe('escribirAtomico', () => {
  it('escribe y no deja temporales', () => {
    const raiz = taller();
    const archivo = join(raiz, 'roadmap.md');
    const antes = '## Pendientes\n\n- [ ] `20AA-1` — **Una.**\n';
    writeFileSync(archivo, antes, 'utf8');
    const despues = '## Pendientes\n\n- [ ] `20AA-1` — **Una.**\n  · prioridad: alta\n';

    escribirAtomico(archivo, despues, hashTexto(antes));

    assert.equal(readFileSync(archivo, 'utf8'), despues);
    assert.deepEqual(readdirSync(raiz), ['roadmap.md']);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('aborta si el archivo cambio entre la lectura y la escritura, sin tocarlo', () => {
    const raiz = taller();
    const archivo = join(raiz, 'roadmap.md');
    const leido = '## Pendientes\n\n- [ ] `20AA-1` — **Una.**\n';
    writeFileSync(archivo, `${leido}- [ ] \`20AA-2\` — **Otra.**\n`, 'utf8');

    assert.throws(() => escribirAtomico(archivo, 'lo que sea', hashTexto(leido)), /archivo-cambio/);
    assert.equal(readFileSync(archivo, 'utf8'), `${leido}- [ ] \`20AA-2\` — **Otra.**\n`);
    assert.deepEqual(readdirSync(raiz), ['roadmap.md']);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('con un roadmap en CRLF escribe el texto tal cual, sin normalizarlo', () => {
    const raiz = taller();
    const archivo = join(raiz, 'roadmap.md');
    const tarea = '- [ ] `20AA-1` — **Una.**\r\n';
    const antes = `## Pendientes\r\n\r\n${tarea}`;
    writeFileSync(archivo, antes, 'utf8');
    const despues = antes.replace(tarea, `${tarea}  · prioridad: alta\r\n`);

    escribirAtomico(archivo, despues, hashTexto(antes));

    assert.equal(readFileSync(archivo, 'utf8'), despues);
    rmSync(raiz, { recursive: true, force: true });
  });
});
