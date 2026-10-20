/* Driver de la escritura roadmap <- TASK (20AA-10 F3).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/tareas/escritura/escribir-roadmaps.test.ts
 * [por que] Es la union de las tres piezas (plan, escritura segura, historial) contra un proyecto
 * de verdad en un directorio temporal: si esto pasa, escribir en el roadmap de un proyecto deja
 * copia, rastro y el texto que se leyo.
 * [por que se inyecta el lector] El mtime real del archivo recien creado seria «ahora» y caeria en
 * la ventana de calma: las fechas van fijas para que la prueba diga siempre lo mismo. El texto si
 * se lee del disco, que es lo que ejercita la escritura de verdad. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analizarRoadmap } from '../../scanner/roadmap/roadmap.js';
import { contenidoDe, huellaDeTarea, textoDeTitulo } from './contenido-tarea.js';
import { escribirRoadmaps, type DepsEscribirRoadmaps, type LecturaRoadmap } from './escribir-roadmaps.js';
import type { PuenteTareas } from '../puente-tareas.js';
import type { ProyectoPuente } from '../tarea-unitaria.js';
import type { ProyectoWm } from '../sincronizacion/sincronizar-tareas.js';
import type { ItemVersionado } from '../nucleo/tipos.js';

const ROADMAP = '## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n';

/* La tarea se edito en TASK a las 12:00 y el archivo no se toca desde las 09:00: TASK manda. */
const TAREA_MS = Date.parse('2026-10-20T12:00:00.000Z');
const ARCHIVO_MS = Date.parse('2026-10-20T09:00:00.000Z');
const ESCRITO_EN = new Date(ARCHIVO_MS).toISOString();
const AHORA_MS = TAREA_MS + 600_000;

const COLUMNAS: ProyectoPuente[] = [{ legacyId: 7, nombre: 'GLORY PULSE', estado: null, orden: null, wmClave: 'glory-pulse' }];

function montar(): { raiz: string; repo: string; proyectos: ProyectoWm[] } {
  const raiz = mkdtempSync(join(tmpdir(), 'wm-escribir-'));
  const repo = join(raiz, 'glory-pulse');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'roadmap.md'), ROADMAP, 'utf8');
  return { raiz, repo, proyectos: [{ clave: 'glory-pulse', nombre: 'GLORY PULSE', ruta: repo }] };
}

const item = (prioridad?: string): ItemVersionado => ({
  id: 900,
  item: {
    id: 900,
    texto: 'Una tarea.',
    parentId: null,
    orden: 0,
    ...(prioridad === undefined ? {} : { prioridad }),
    roadmap: { id: '20AA-1', huella: 'vieja', escritoEn: ESCRITO_EN, espejo: { texto: 'Una tarea.' } },
  },
  updatedAt: new Date(TAREA_MS).toISOString(),
});

/* Lee el archivo de verdad, pero con la fecha que diga la prueba. */
const leerCon = (mtimeMs: number) => (ruta: string): LecturaRoadmap | null => {
  const archivo = join(ruta, 'roadmap.md');
  if (!existsSync(archivo)) return null;
  const texto = readFileSync(archivo, 'utf8');
  return { texto, mtimeMs, tareas: analizarRoadmap(texto).tareas };
};

function deps(
  raiz: string,
  proyectos: ProyectoWm[],
  tareas: ItemVersionado[],
  cols: ProyectoPuente[] = COLUMNAS,
  mtimeMs = ARCHIVO_MS,
): DepsEscribirRoadmaps {
  const puente = {
    proyectos: () => Promise.resolve(cols),
    listar: () => Promise.resolve(tareas),
  } as unknown as PuenteTareas;
  return { proyectos: () => proyectos, puente, raizRepo: raiz, ahora: () => AHORA_MS, leerRoadmap: leerCon(mtimeMs) };
}

describe('escribirRoadmaps', () => {
  it('en seco cuenta lo que haria y no toca el archivo', async () => {
    const { raiz, repo, proyectos } = montar();
    const informe = await escribirRoadmaps(deps(raiz, proyectos, [item('alta')]), { seco: true });

    assert.equal(informe.seco, true);
    assert.equal(informe.cambios, 1);
    assert.equal(informe.escribio, 0);
    assert.equal(readFileSync(join(repo, 'roadmap.md'), 'utf8'), ROADMAP);
    assert.equal(existsSync(join(raiz, 'data')), false);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('escribe la propiedad en el roadmap, con copia previa y rastro', async () => {
    const { raiz, repo, proyectos } = montar();
    const informe = await escribirRoadmaps(deps(raiz, proyectos, [item('alta')]));

    assert.equal(informe.escribio, 1);
    assert.equal(informe.cambios, 1);
    assert.deepEqual(informe.avisos, []);
    assert.equal(readFileSync(join(repo, 'roadmap.md'), 'utf8'), `${ROADMAP}  · prioridad: alta\n`);

    const carpeta = join(raiz, 'data', 'respaldos-roadmap', 'glory-pulse');
    const copias = readdirSync(carpeta);
    assert.equal(copias.length, 1);
    assert.equal(readFileSync(join(carpeta, copias[0]), 'utf8'), ROADMAP);

    const historial = readFileSync(join(raiz, 'data', 'historial-roadmap', 'glory-pulse.ndjson'), 'utf8').trim().split('\n');
    assert.equal(historial.length, 1);
    const entrada = JSON.parse(historial[0]) as Record<string, unknown>;
    assert.equal(entrada.tarea, '20AA-1');
    assert.equal(entrada.origen, 'task');
    assert.equal(entrada.campo, 'prioridad');
    assert.equal(entrada.antes, null);
    assert.equal(entrada.despues, 'alta');
    assert.equal(entrada.sitio, 'roadmap.md:3');
    rmSync(raiz, { recursive: true, force: true });
  });

  it('la segunda pasada no cambia nada', async () => {
    const { raiz, repo, proyectos } = montar();
    await escribirRoadmaps(deps(raiz, proyectos, [item('alta')]));
    const escrito = readFileSync(join(repo, 'roadmap.md'), 'utf8');
    const carpeta = join(raiz, 'data', 'respaldos-roadmap', 'glory-pulse');
    const copiasAntes = readdirSync(carpeta).length;

    const segunda = await escribirRoadmaps(deps(raiz, proyectos, [item('alta')]));

    assert.equal(segunda.cambios, 0);
    assert.equal(segunda.escribio, 0);
    assert.equal(segunda.detalle[0].alDia, 1);
    assert.equal(readFileSync(join(repo, 'roadmap.md'), 'utf8'), escrito);
    assert.equal(readdirSync(carpeta).length, copiasAntes);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('el conflicto se avisa y no se escribe nada de esa tarea', async () => {
    const { raiz, repo, proyectos } = montar();
    /* El archivo es mas viejo que lo ultimo que escribio el puente: no se sabe quien manda. */
    const enTask = [item('baja')];
    enTask[0].item.roadmap = {
      id: '20AA-1',
      huella: 'vieja',
      escritoEn: new Date(TAREA_MS + 60_000).toISOString(),
      espejo: { texto: 'Una tarea.' },
    };

    const informe = await escribirRoadmaps(deps(raiz, proyectos, enTask));

    assert.equal(informe.conflictos, 1);
    assert.equal(informe.avisos[0].id, '20AA-1');
    assert.equal(informe.avisos[0].clave, 'glory-pulse');
    assert.equal(informe.escribio, 0);
    assert.equal(readFileSync(join(repo, 'roadmap.md'), 'utf8'), ROADMAP);
    assert.equal(existsSync(join(raiz, 'data')), false);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('un proyecto sin columna en TASK no se toca', async () => {
    const { raiz, repo, proyectos } = montar();
    const informe = await escribirRoadmaps(deps(raiz, proyectos, [], []));

    assert.equal(informe.proyectos, 1);
    assert.equal(informe.detalle.length, 0);
    assert.equal(readFileSync(join(repo, 'roadmap.md'), 'utf8'), ROADMAP);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('un proyecto sin roadmap no cuenta', async () => {
    const { raiz, proyectos } = montar();
    const otro: ProyectoWm[] = [{ clave: 'glory-pulse', nombre: 'GLORY PULSE', ruta: join(raiz, 'sin-roadmap') }];
    const informe = await escribirRoadmaps(deps(raiz, otro, [item('alta')], COLUMNAS, ARCHIVO_MS));

    assert.equal(informe.proyectos, 0);
    assert.equal(informe.escribio, 0);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('un roadmap tocado hace un momento no se escribe en esta pasada', async () => {
    const { raiz, repo, proyectos } = montar();
    /* El archivo no ha cambiado desde que el puente lo escribio (la huella cuadra) y TASK si: es
     * el caso que pide escribir el archivo, y la ventana de calma lo deja para la siguiente. */
    const t = analizarRoadmap(ROADMAP).tareas[0];
    const enTask = [item('alta')];
    enTask[0].item.roadmap = {
      id: '20AA-1',
      huella: huellaDeTarea(t),
      escritoEn: ESCRITO_EN,
      espejo: contenidoDe(t.propiedades, textoDeTitulo(t.titulo)),
    };

    const informe = await escribirRoadmaps(deps(raiz, proyectos, enTask, COLUMNAS, AHORA_MS - 1_000));

    assert.equal(informe.detalle[0].enCalma, true);
    assert.equal(informe.detalle[0].cambios, 1);
    assert.equal(informe.escribio, 0);
    assert.equal(readFileSync(join(repo, 'roadmap.md'), 'utf8'), ROADMAP);
    rmSync(raiz, { recursive: true, force: true });
  });
});
