/* Acciones del tab sobre el roadmap (20AA-10 F3b).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/tareas/escritura/accion-archivo.test.ts
 * [por que] Crear, cerrar, borrar y reordenar tocan el archivo de otro proyecto. Un fallo aqui no
 * rompe nada visible: deja un roadmap a medias, con una linea de propiedades huerfana o con la prosa
 * de al lado movida de sitio. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analizarRoadmap, type TareaRoadmap } from '../../scanner/roadmap/roadmap.js';
import {
  bloqueDeTarea,
  entradaCompletado,
  insertarTarea,
  lineasDeTarea,
  quitarTarea,
  reordenarTareas,
  seccionDe,
  siguienteId,
} from './accion-archivo.js';

const HOY = new Date('2026-10-20T12:00:00.000Z');

const CUERPO = [
  '## Pendientes',
  '',
  '- [ ] `20AA-1` — **Primera.** Prosa que sigue en la linea de al lado',
  '  · prioridad: alta',
  '  y termina aqui.',
  '  - [ ] **Subtarea suya.**',
  '',
  '- [ ] `20AA-2` — **Segunda.**',
  '',
  '## Bloqueos',
  '',
  '- Nada.',
  '',
];

const tareas = (lineas: string[]): TareaRoadmap[] => analizarRoadmap(lineas.join('\n')).tareas;
const buscar = (lineas: string[], id: string): TareaRoadmap => {
  const t = tareas(lineas).find((x) => x.id === id);
  if (t === undefined) throw new Error(`sin tarea ${id}`);
  return t;
};

void describe('accion-archivo', () => {
  void it('el bloque de una tarea se lleva propiedades, subtareas y prosa, y no la siguiente', () => {
    const t = buscar(CUERPO, '20AA-1');
    assert.deepEqual(bloqueDeTarea(CUERPO, t), { desde: 2, hasta: 6 });
    assert.deepEqual(bloqueDeTarea(CUERPO, buscar(CUERPO, '20AA-2')), { desde: 7, hasta: 8 });
  });

  void it('quitar una tarea no deja hueco doble ni linea de propiedades huerfana', () => {
    const fuera = quitarTarea(CUERPO, buscar(CUERPO, '20AA-1'));
    assert.deepEqual(fuera, ['## Pendientes', '', '- [ ] `20AA-2` — **Segunda.**', '', '## Bloqueos', '', '- Nada.', '']);
    assert.deepEqual(tareas(fuera).map((t) => t.id), ['20AA-2']);
  });

  void it('quitar la ultima de una seccion deja la seccion vacia y el encabezado siguiente intacto', () => {
    const fuera = quitarTarea(CUERPO, buscar(CUERPO, '20AA-2'));
    assert.deepEqual(fuera, [
      '## Pendientes',
      '',
      '- [ ] `20AA-1` — **Primera.** Prosa que sigue en la linea de al lado',
      '  · prioridad: alta',
      '  y termina aqui.',
      '  - [ ] **Subtarea suya.**',
      '',
      '## Bloqueos',
      '',
      '- Nada.',
      '',
    ]);
  });

  void it('la seccion de una tarea es el `##` de mas arriba', () => {
    assert.equal(seccionDe(CUERPO, 3), 'Pendientes');
    assert.equal(seccionDe(CUERPO, 12), 'Bloqueos');
  });

  void it('siguienteId toma el prefijo del dia y salta los ocupados', () => {
    assert.equal(siguienteId([], HOY), '20AA-1');
    assert.equal(siguienteId(['20AA-1', '20AA-2'], HOY), '20AA-3');
    /* Los IDs son unicos dentro del proyecto: los de otro dia no estorban. */
    assert.equal(siguienteId(['19AA-1', '19AA-2'], HOY), '20AA-1');
  });

  void it('la linea nueva lleva negrita y la de propiedades solo si hay algo que decir', () => {
    assert.deepEqual(lineasDeTarea('20AA-3', 'Comprar pan.', {}), ['- [ ] `20AA-3` — **Comprar pan.**']);
    /* El texto puede llegar con punto (de un roadmap) o sin el (recien escrito en el tab), y el
     * titulo del protocolo acaba siempre en uno solo. */
    assert.deepEqual(lineasDeTarea('20AA-3', 'Comprar pan', {}), ['- [ ] `20AA-3` — **Comprar pan.**']);
    assert.deepEqual(lineasDeTarea('20AA-3', 'Comprar pan...', {}), ['- [ ] `20AA-3` — **Comprar pan.**']);
    assert.deepEqual(lineasDeTarea('20AA-3', 'Comprar pan.', { prioridad: 'alta', etiquetas: ['casa', 'compra'] }), [
      '- [ ] `20AA-3` — **Comprar pan.**',
      '  · prioridad: alta · etiquetas: casa, compra',
    ]);
  });

  void it('insertarTarea la deja al final de su seccion, antes del encabezado siguiente', () => {
    const r = insertarTarea(CUERPO, { id: '20AA-3', texto: 'Tercera.', propiedades: {}, seccion: 'Pendientes' });
    assert.ok(r !== null);
    assert.deepEqual(r.lineas, [
      '## Pendientes',
      '',
      '- [ ] `20AA-1` — **Primera.** Prosa que sigue en la linea de al lado',
      '  · prioridad: alta',
      '  y termina aqui.',
      '  - [ ] **Subtarea suya.**',
      '',
      '- [ ] `20AA-2` — **Segunda.**',
      '',
      '- [ ] `20AA-3` — **Tercera.**',
      '',
      '## Bloqueos',
      '',
      '- Nada.',
      '',
    ]);
    /* La linea que devuelve es la de la tarea nueva (1-based) y el analisis la ve. */
    assert.equal(r.linea, 10);
    assert.deepEqual(tareas(r.lineas).map((t) => t.id), ['20AA-1', '20AA-2', '20AA-3']);
  });

  void it('insertarTarea no inventa una seccion que no existe', () => {
    assert.equal(insertarTarea(CUERPO, { id: '20AA-3', texto: 'x', propiedades: {}, seccion: 'Lo que sea' }), null);
  });

  void it('reordenar mueve el bloque entero y deja la prosa donde estaba', () => {
    const lineas = [
      '## Pendientes',
      '',
      '- [ ] `20AA-1` — **Primera.**',
      '  · prioridad: alta',
      '',
      'Prosa entre las dos.',
      '',
      '- [ ] `20AA-2` — **Segunda.**',
      '  - [ ] **Su subtarea.**',
      '',
    ];
    const nuevas = reordenarTareas(lineas, tareas(lineas), ['20AA-2', '20AA-1']);
    assert.deepEqual(nuevas, [
      '## Pendientes',
      '',
      '- [ ] `20AA-2` — **Segunda.**',
      '  - [ ] **Su subtarea.**',
      '',
      'Prosa entre las dos.',
      '',
      '- [ ] `20AA-1` — **Primera.**',
      '  · prioridad: alta',
      '',
    ]);
    /* Y la prosa sigue siendo prosa: el analisis no gana problemas. */
    assert.deepEqual(analizarRoadmap(nuevas.join('\n')).problemas, []);
  });

  void it('reordenar no toca las tareas que el tab no menciona', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Uno.**', '', '- [ ] `20AA-2` — **Dos.**', '', '- [ ] `20AA-3` — **Tres.**', ''];
    /* El tab manda solo dos (la tercera aun no esta en su columna): se intercambian entre sus dos
     * huecos y la tercera se queda donde estaba. */
    const nuevas = reordenarTareas(lineas, tareas(lineas), ['20AA-2', '20AA-1']);
    assert.deepEqual(nuevas, ['## Pendientes', '', '- [ ] `20AA-2` — **Dos.**', '', '- [ ] `20AA-1` — **Uno.**', '', '- [ ] `20AA-3` — **Tres.**', '']);
  });

  void it('reordenar con menos de dos tareas conocidas no cambia nada', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Uno.**', ''];
    assert.deepEqual(reordenarTareas(lineas, tareas(lineas), ['20AA-1', '20AA-9']), lineas);
  });

  void it('la prosa de la seccion tras un hueco no entra en el bloque de la tarea', () => {
    /* La forma real de los roadmaps del area: el titulo sigue en lineas indentadas y la de
     * propiedades va al final, pegada. Y despues, separada por un hueco, la prosa de la seccion. */
    const lineas = [
      '## Pendientes',
      '',
      '- [ ] `20AA-1` — **Un titulo largo** que sigue',
      '   en la linea de abajo y acaba aqui',
      '  · prioridad: alta',
      '',
      'Una nota de la seccion que no es de nadie.',
      '',
      '- [ ] `20AA-2` — **Otra.**',
      '',
    ];
    const t = buscar(lineas, '20AA-1');
    assert.deepEqual(bloqueDeTarea(lineas, t), { desde: 2, hasta: 5 });
    /* Borrar la tarea se lleva su prosa y su linea de propiedades, y deja la nota. */
    assert.deepEqual(quitarTarea(lineas, t), [
      '## Pendientes',
      '',
      'Una nota de la seccion que no es de nadie.',
      '',
      '- [ ] `20AA-2` — **Otra.**',
      '',
    ]);
    /* Y al reordenar, la nota tampoco viaja con la tarea. */
    assert.deepEqual(reordenarTareas(lineas, tareas(lineas), ['20AA-2', '20AA-1']), [
      '## Pendientes',
      '',
      '- [ ] `20AA-2` — **Otra.**',
      '',
      'Una nota de la seccion que no es de nadie.',
      '',
      '- [ ] `20AA-1` — **Un titulo largo** que sigue',
      '   en la linea de abajo y acaba aqui',
      '  · prioridad: alta',
      '',
    ]);
  });

  void it('la entrada de completados dice el ID, el texto y el dia', () => {
    assert.equal(entradaCompletado('20AA-3', 'Comprar pan.', HOY), '- **20AA-3 · Comprar pan.** Cerrada desde el tab (TASK), 2026-10-20.');
    assert.equal(entradaCompletado('20AA-3', 'Comprar pan', HOY), '- **20AA-3 · Comprar pan.** Cerrada desde el tab (TASK), 2026-10-20.');
  });
});
