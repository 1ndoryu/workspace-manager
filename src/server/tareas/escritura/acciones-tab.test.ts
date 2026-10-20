/* Cableado de las acciones del tab con el roadmap (20AA-10 F3b).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/tareas/escritura/acciones-tab.test.ts
 * [por que] Es la union de las dos mitades: lo que el puente acaba de escribir en TASK y lo que le
 * toca al archivo. Un fallo aqui deja la tarjeta guardada y el roadmap con la linea vieja, o crea
 * una tarea de TASK sin espejo (que la pasada siguiente duplicaria). Se prueba contra un
 * directorio temporal y un puente de mentira: ni se toca un proyecto de verdad ni se sale a red. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analizarRoadmap } from '../../scanner/roadmap/roadmap.js';
import { espejoDeItem, huellaDeTarea, huellaDeTexto } from './contenido-tarea.js';
import {
  confirmarBorrado,
  prepararBorrado,
  proyectoDeColumna,
  trasGuardar,
  trasReordenar,
  type DepsAccionesTab,
} from './acciones-tab.js';
import type { ItemVersionado, ReordenarMovimiento } from '../nucleo/tipos.js';
import type { PuenteTareas } from '../puente-tareas.js';

const T = Date.parse('2026-10-20T12:00:00.000Z');
const COLUMNA = 700;

const CUERPO = [
  '## Pendientes',
  '',
  '- [ ] `20AA-1` — **Primera.**',
  '  · prioridad: alta',
  '',
  '- [ ] `20AA-2` — **Segunda.**',
  '',
  '## Bloqueos',
  '',
  '- Nada.',
  '',
].join('\n');

/* El mismo roadmap con una subtarea escrita bajo `20AA-1`: es lo que hay que editar y borrar. */
const CON_SUB = CUERPO.replace('  · prioridad: alta\n', '  · prioridad: alta\n  - [ ] **Su subtarea.**\n');

interface Taller {
  raiz: string;
  deps: DepsAccionesTab;
  leer: () => string;
  /* El item de TASK tal como lo devolveria el puente. */
  item: (id: number, campos: Record<string, unknown>) => ItemVersionado;
}

function taller(
  texto: string = CUERPO,
  /* Lo que devuelve `puente.listar`: la columna de TASK. */
  enTask: ItemVersionado[] = [],
  falla: string | null = null,
): Taller {
  const raiz = mkdtempSync(join(tmpdir(), 'wm-tab-'));
  const ruta = join(raiz, 'proyecto');
  mkdirSync(ruta, { recursive: true });
  writeFileSync(join(ruta, 'roadmap.md'), texto, 'utf8');
  const puente = {
    proyectos: () => {
      if (falla !== null) throw new Error(falla);
      return Promise.resolve([{ legacyId: COLUMNA, nombre: 'Proyecto', orden: 0, estado: 'activo', wmClave: 'proyecto' }]);
    },
    listar: () => (falla !== null ? Promise.reject(new Error(falla)) : Promise.resolve(enTask)),
  } as unknown as PuenteTareas;
  return {
    raiz,
    deps: { proyectos: () => [{ clave: 'proyecto', nombre: 'Proyecto', ruta }], puente, raizRepo: raiz, ahora: () => T },
    leer: () => readFileSync(join(ruta, 'roadmap.md'), 'utf8'),
    item: (id, campos) => ({ id, item: campos, updatedAt: '2026-10-20T12:00:00.000Z' }),
  };
}

/* El item de una tarea que el puente ya espejo: lleva su `payload.roadmap`. */
function espejado(id: number, roadmapId: string, campos: Record<string, unknown>): ItemVersionado {
  return {
    id,
    item: { proyectoId: COLUMNA, parentId: null, orden: 0, completado: false, ...campos, roadmap: { id: roadmapId } },
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
}

/* Una tarjeta de TASK que no nacio del roadmap: sin `payload.roadmap`. */
function sinEspejo(id: number): ItemVersionado {
  return { id, item: { proyectoId: COLUMNA, parentId: null, texto: 'De TASK.' }, updatedAt: '2026-10-20T12:00:00.000Z' };
}

/* La subtarea de TASK tal como la deja el puente: con su espejo, que lleva el ID del padre. */
function subtareaDe(id: number, padreId: number, campos: Record<string, unknown>, hueco = 0, textoEspejo = 'Su subtarea.'): ItemVersionado {
  return {
    id,
    item: {
      proyectoId: COLUMNA,
      parentId: padreId,
      orden: hueco,
      texto: 'Su subtarea.',
      ...campos,
      roadmap: {
        id: '20AA-1',
        proyecto: 'proyecto',
        archivo: 'roadmap.md',
        seccion: 'Pendientes',
        huella: huellaDeTexto(textoEspejo, {}),
        escritoEn: '2026-10-20T12:00:00.000Z',
        mtimeArchivo: null,
        espejo: { texto: textoEspejo, prioridad: null, urgencia: null, etiquetas: [], dependeDe: [], fechas: {} },
        sub: true,
        padre: '20AA-1',
        hueco,
      },
    },
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
}

void describe('acciones-tab', () => {
  void it('la columna se empareja con el proyecto por wmClave, y una columna ajena no tiene roadmap', async () => {
    const t = taller();
    assert.equal((await proyectoDeColumna(t.deps, COLUMNA))?.clave, 'proyecto');
    assert.equal(await proyectoDeColumna(t.deps, 999), null);
  });

  void it('un alta crea la linea y devuelve el parche para grabar el espejo con el ID del roadmap', async () => {
    const t = taller();
    const item = t.item(9001, { proyectoId: COLUMNA, parentId: null, texto: 'Tercera.', prioridad: 'alta' });
    const r = await trasGuardar(t.deps, COLUMNA, item, { texto: 'Tercera.', proyectoId: COLUMNA, orden: 2 });
    assert.equal(r.roadmap?.accion, 'crear');
    assert.equal(r.roadmap?.id, '20AA-3');
    assert.equal(r.roadmap?.escribio, true);
    assert.match(t.leer(), /- \[ \] `20AA-3` — \*\*Tercera\.\*\*\n  · prioridad: alta/);

    /* El parche que se repite lleva el espejo entero, con la huella de la linea tal como quedo. */
    const payload = r.repetir?.payload as Record<string, unknown> | undefined;
    const espejo = espejoDeItem({ roadmap: payload?.roadmap });
    assert.equal(espejo?.id, '20AA-3');
    assert.equal(espejo?.proyecto, 'proyecto');
    const tarea = analizarRoadmap(t.leer()).tareas.find((x) => x.id === '20AA-3');
    assert.ok(tarea !== undefined);
    assert.equal(espejo?.huella, huellaDeTarea(tarea));
    assert.deepEqual(espejo?.espejo, { texto: 'Tercera.', prioridad: 'alta', urgencia: null, etiquetas: [], dependeDe: [], fechas: {} });
    /* El PUT es de reemplazo: el parche repetido trae todos los campos, no solo el payload. */
    assert.equal(r.repetir?.texto, 'Tercera.');
    assert.equal(r.repetir?.completado, false);
    assert.equal(r.repetir?.proyectoId, COLUMNA);
    assert.equal(r.repetir?.urgencia, 'normal');
  });

  void it('una urgencia normal no se escribe en la linea: es el defecto de TASK, no algo dicho', async () => {
    const t = taller();
    const item = t.item(9002, { proyectoId: COLUMNA, parentId: null, texto: 'Cuarta.', urgencia: 'normal' });
    await trasGuardar(t.deps, COLUMNA, item, { texto: 'Cuarta.', proyectoId: COLUMNA, orden: 2 });
    assert.match(t.leer(), /- \[ \] `20AA-3` — \*\*Cuarta\.\*\*\n\n## Bloqueos/);
  });

  void it('editar reescribe la linea de la tarea que ya tenia espejo', async () => {
    const t = taller();
    const item = espejado(9001, '20AA-1', { texto: 'Primera cambiada.' });
    const r = await trasGuardar(t.deps, COLUMNA, item, { texto: 'Primera cambiada.', proyectoId: COLUMNA });
    assert.equal(r.roadmap?.accion, 'editar');
    assert.equal(r.roadmap?.escribio, true);
    assert.equal(r.repetir, null);
    assert.match(t.leer(), /- \[ \] `20AA-1` — \*\*Primera cambiada\.\*\*/);
  });

  void it('completar en TASK saca la linea del roadmap y la anota en completados', async () => {
    const t = taller();
    const item = espejado(9001, '20AA-1', { texto: 'Primera.', completado: true });
    const r = await trasGuardar(t.deps, COLUMNA, item, { texto: 'Primera.', proyectoId: COLUMNA, completado: true });
    assert.equal(r.roadmap?.accion, 'cerrar');
    assert.equal(r.roadmap?.aviso, null);
    assert.equal(analizarRoadmap(t.leer()).tareas.some((x) => x.id === '20AA-1'), false);
    assert.match(readFileSync(join(t.raiz, 'proyecto', 'Agente', 'completados', 'tareas-2026-10-20.md'), 'utf8'), /20AA-1 · Primera\./);
  });

  void it('destildar devuelve la tarea al roadmap, y repetirlo no es un aviso', async () => {
    const t = taller();
    const completados = join(t.raiz, 'proyecto', 'Agente', 'completados', 'tareas-2026-10-20.md');
    const ida = espejado(9001, '20AA-1', { texto: 'Primera.', completado: true });
    await trasGuardar(t.deps, COLUMNA, ida, { texto: 'Primera.', proyectoId: COLUMNA, completado: true });
    assert.match(readFileSync(completados, 'utf8'), /20AA-1/);
    const vuelta = espejado(9001, '20AA-1', { texto: 'Primera.', completado: false });
    const r = await trasGuardar(t.deps, COLUMNA, vuelta, { texto: 'Primera.', proyectoId: COLUMNA, completado: false });
    assert.equal(r.roadmap?.accion, 'reabrir');
    assert.equal(r.roadmap?.escribio, true);
    assert.equal(analizarRoadmap(t.leer()).tareas.some((x) => x.id === '20AA-1'), true);
    /* Reabrir limpia el registro de completados: dejarlo diria cerrada una tarea que el roadmap da
     * por pendiente (dos fuentes, dos versiones). El encabezado del archivo se queda. */
    assert.equal(readFileSync(completados, 'utf8').includes('20AA-1'), false);
    /* Ya esta en el archivo: no hay nada que hacer y no se le cuenta a nadie. */
    const otra = await trasGuardar(t.deps, COLUMNA, vuelta, { texto: 'Primera.', proyectoId: COLUMNA, completado: false });
    assert.equal(otra.roadmap?.escribio, false);
    assert.equal(otra.roadmap?.aviso, null);
  });

  void it('un alta de subtarea escribe la linea sangrada y devuelve el espejo de la subtarea', async () => {
    const t = taller(CUERPO, [espejado(9001, '20AA-1', { texto: 'Primera.' })]);
    const item: ItemVersionado = {
      id: 9002,
      item: { proyectoId: COLUMNA, parentId: 9001, orden: 1, texto: 'Otra suya.', completado: false },
      updatedAt: '2026-10-20T12:00:00.000Z',
    };
    const r = await trasGuardar(t.deps, COLUMNA, item, { texto: 'Otra suya.', parentId: 9001 });
    assert.equal(r.roadmap?.accion, 'crear-sub');
    assert.equal(r.roadmap?.escribio, true);
    assert.equal(r.roadmap?.id, '20AA-1#1');
    assert.match(t.leer(), /^ {2}- \[ \] \*\*Otra suya\.\*\*$/m);
    /* El espejo de la subtarea lleva el ID del padre y su hueco: sin ellos, la proxima edicion no
     * sabria que linea reescribir. */
    const espejo = espejoDeItem({ roadmap: (r.repetir?.payload as Record<string, unknown> | undefined)?.roadmap });
    assert.equal(espejo?.sub, true);
    assert.equal(espejo?.padre, '20AA-1');
    assert.equal(espejo?.hueco, 0);
    assert.equal(espejo?.huella, huellaDeTexto('Otra suya.', {}));
    /* El PUT repetido es de reemplazo: lleva el texto y la columna, no solo el payload. */
    assert.equal(r.repetir?.texto, 'Otra suya.');
    assert.equal(r.repetir?.proyectoId, COLUMNA);
    assert.equal(r.repetir?.parentId, 9001);
  });

  void it('marcar una subtarea escribe su casilla, sin sacarla del bloque del padre', async () => {
    const enTask = [espejado(9001, '20AA-1', { texto: 'Primera.' }), subtareaDe(9002, 9001, { completado: true })];
    const t = taller(CON_SUB, enTask);
    const r = await trasGuardar(t.deps, COLUMNA, enTask[1] as ItemVersionado, { texto: 'Su subtarea.', completado: true });
    assert.equal(r.roadmap?.accion, 'editar-sub');
    assert.equal(r.roadmap?.escribio, true);
    assert.match(t.leer(), /^ {2}- \[x\] \*\*Su subtarea\.\*\*$/m);
    /* La tarea padre sigue pendiente en el archivo, con su linea de propiedades. */
    assert.match(t.leer(), /- \[ \] `20AA-1` — \*\*Primera\.\*\*\n {2}· prioridad: alta/);
  });

  void it('editar el texto de una subtarea la encuentra por su hueco y refresca la huella', async () => {
    const enTask = [espejado(9001, '20AA-1', { texto: 'Primera.' }), subtareaDe(9002, 9001, { texto: 'Su subtarea cambiada.' })];
    const t = taller(CON_SUB, enTask);
    const r = await trasGuardar(t.deps, COLUMNA, enTask[1] as ItemVersionado, { texto: 'Su subtarea cambiada.' });
    assert.equal(r.roadmap?.escribio, true);
    assert.match(t.leer(), /^ {2}- \[ \] \*\*Su subtarea cambiada\.\*\*$/m);
    const espejo = espejoDeItem({ roadmap: (r.repetir?.payload as Record<string, unknown> | undefined)?.roadmap });
    assert.equal(espejo?.huella, huellaDeTexto('Su subtarea cambiada.', {}));
    assert.equal(espejo?.hueco, 0);
  });

  void it('una subtarea cuyo padre no viene del roadmap no toca el archivo', async () => {
    const t = taller(CUERPO, [sinEspejo(9001), subtareaDe(9002, 9001, {})]);
    const enTask = [sinEspejo(9001), subtareaDe(9002, 9001, {})];
    const r = await trasGuardar(t.deps, COLUMNA, enTask[1] as ItemVersionado, { texto: 'Su subtarea.' });
    assert.deepEqual(r, { roadmap: null, repetir: null });
    assert.equal(t.leer(), CUERPO);
  });

  void it('borrar una subtarea se lleva su linea y deja el bloque del padre entero', async () => {
    const enTask = [espejado(9001, '20AA-1', { texto: 'Primera.' }), subtareaDe(9002, 9001, {})];
    const t = taller(CON_SUB, enTask);
    const pendiente = await prepararBorrado(t.deps, COLUMNA, 9002);
    assert.equal(pendiente?.tipo, 'subtarea');
    const r = confirmarBorrado(t.deps, pendiente as NonNullable<typeof pendiente>);
    assert.equal(r.accion, 'borrar-sub');
    assert.equal(r.escribio, true);
    assert.equal(analizarRoadmap(t.leer()).tareas[0]?.subtareas.length, 0);
    /* El padre sigue donde estaba, con su ID y sus propiedades. */
    assert.match(t.leer(), /- \[ \] `20AA-1` — \*\*Primera\.\*\*\n {2}· prioridad: alta\n\n- \[ \] `20AA-2`/);
  });

  void it('si el puente no responde, el aviso lo dice en vez de tirar la respuesta', async () => {
    const t = taller(CUERPO, [], 'red-tasks');
    const item = espejado(9001, '20AA-1', { texto: 'Primera.' });
    const r = await trasGuardar(t.deps, COLUMNA, item, { texto: 'Primera.' });
    assert.equal(r.roadmap?.escribio, false);
    assert.match(r.roadmap?.aviso ?? '', /^roadmap-no-escrito: red-tasks$/);
  });

  void it('borrar quita la linea, y sin linea que tocar no devuelve nada', async () => {
    const enTask = [espejado(9001, '20AA-1', { texto: 'Primera.' })];
    const t = taller(CUERPO, enTask);
    const pendiente = await prepararBorrado(t.deps, COLUMNA, 9001);
    assert.equal(pendiente?.tipo === 'tarea' ? pendiente.id : null, '20AA-1');
    assert.equal(confirmarBorrado(t.deps, pendiente as NonNullable<typeof pendiente>).escribio, true);
    assert.equal(analizarRoadmap(t.leer()).tareas.some((x) => x.id === '20AA-1'), false);

    /* Una tarjeta de TASK que no viene del roadmap no tiene linea que quitar. */
    const suelta = taller(CUERPO, [t.item(9002, { proyectoId: COLUMNA, texto: 'De TASK.' })]);
    assert.equal(await prepararBorrado(suelta.deps, COLUMNA, 9002), null);
  });

  void it('reordenar lleva al archivo el orden que manda el tab, saltando lo que no es del roadmap', async () => {
    const enTask = [
      espejado(9001, '20AA-1', { texto: 'Primera.' }),
      espejado(9002, '20AA-2', { texto: 'Segunda.' }),
      sinEspejo(9003),
    ];
    const t = taller(CUERPO, enTask);
    const movs: ReordenarMovimiento[] = [
      { legacyId: 9002, orden: 0, proyectoId: COLUMNA },
      { legacyId: 9003, orden: 1, proyectoId: COLUMNA },
      { legacyId: 9001, orden: 2, proyectoId: COLUMNA },
    ];
    const r = await trasReordenar(t.deps, movs);
    assert.equal(r.length, 1);
    assert.equal(r[0]?.escribio, true);
    assert.deepEqual(analizarRoadmap(t.leer()).tareas.map((x) => x.id), ['20AA-2', '20AA-1']);
  });

  void it('un reorden con una sola tarea del roadmap no escribe el archivo', async () => {
    const t = taller(CUERPO, [espejado(9001, '20AA-1', { texto: 'Primera.' })]);
    const r = await trasReordenar(t.deps, [{ legacyId: 9001, orden: 0, proyectoId: COLUMNA }]);
    assert.deepEqual(r, []);
    assert.equal(t.leer(), CUERPO);
  });
});
