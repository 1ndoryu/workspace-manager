/* Puras de la tab tareas (07AA-5 F3): contrato sin React ni red.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/tareas/tareasTab.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arbolDeTareas,
  clonarCacheTareas,
  columnasDeRespuesta,
  completadoTarea,
  construirMovimientos,
  dependeDeTarea,
  esColumnaTab,
  esSubtarea,
  esTareaTab,
  etiquetasTarea,
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_URGENCIA,
  fechaValida,
  fechasTarea,
  generarIdTarea,
  listaATexto,
  listaTecleada,
  padreDeTarea,
  parcheConColumna,
  PRIORIDADES_TAREA,
  prioridadTarea,
  restaurarCacheTareas,
  tareaDePuente,
  tareasDeRespuesta,
  textoTarea,
  URGENCIAS_TAREA,
  urgenciaTarea,
  type TareaTab,
} from './tareasTab.js';

/* Forma REAL que sirve GET /api/tareas/proyecto (verificada en vivo
 * 2026-10-07 contra la permanente: envoltorio {id, item, updatedAt}).
 * Los tests F3 usaban {legacyId, orden, campos} —forma que nada emite—
 * y por eso el bug (columnas siempre vacias) paso los 14/14. */
const ITEM_PUENTE = {
  id: 9201,
  item: {
    completado: false,
    id: 9201,
    orden: 0,
    parentId: null,
    prioridad: null,
    proyectoId: 9001,
    texto: 'Demo A-1',
    urgencia: 'normal',
  },
  updatedAt: '2026-10-07T21:34:14.825702Z',
};

const TAREA: TareaTab = { legacyId: 9201, orden: 0, proyectoId: 9001, campos: { texto: 'hola' } };

describe('tareaDePuente', () => {
  it('normaliza el item real del proxy', () => {
    const got = tareaDePuente(ITEM_PUENTE);
    assert.equal(got?.legacyId, 9201);
    assert.equal(got?.orden, 0);
    assert.equal(got?.proyectoId, 9001);
    assert.equal(textoTarea(got!), 'Demo A-1');
    assert.equal(esTareaTab(got), true);
  });
  it('rechaza sin id entero', () => assert.equal(tareaDePuente({ ...ITEM_PUENTE, id: 'x' }), null));
  it('rechaza sin item', () => assert.equal(tareaDePuente({ id: 1 }), null));
  it('rechaza orden no entero', () =>
    assert.equal(tareaDePuente({ id: 1, item: { orden: 1.5 } }), null));
  it('rechaza nulos', () => assert.equal(tareaDePuente(null), null));
});

describe('esTareaTab', () => {
  it('acepta la forma normalizada', () => assert.equal(esTareaTab(TAREA), true));
  it('rechaza sin campos', () => assert.equal(esTareaTab({ legacyId: 1, orden: 0 }), false));
  it('rechaza orden no entero', () => assert.equal(esTareaTab({ ...TAREA, orden: 1.5 }), false));
  it('rechaza nulos', () => assert.equal(esTareaTab(null), false));
});

describe('tareasDeRespuesta', () => {
  it('normaliza la respuesta real del proxy sin perder tareas', () => {
    const got = tareasDeRespuesta({ tareas: [ITEM_PUENTE, { ...ITEM_PUENTE, id: 9202 }] });
    assert.equal(got.length, 2);
    assert.deepEqual(
      got.map((t) => t.legacyId),
      [9201, 9202],
    );
  });
  it('descarta lo que no sea item', () => {
    const got = tareasDeRespuesta({ tareas: [ITEM_PUENTE, { legacyId: 'x' }, null, 42] });
    assert.equal(got.length, 1);
    assert.equal(got[0].legacyId, 9201);
  });
  it('sin lista devuelve vacio', () => {
    assert.deepEqual(tareasDeRespuesta({}), []);
    assert.deepEqual(tareasDeRespuesta(null), []);
  });
});

describe('textoTarea', () => {
  it('prefiere texto', () => assert.equal(textoTarea(TAREA), 'hola'));
  it('cae a titulo/nombre/name', () => {
    assert.equal(textoTarea({ ...TAREA, campos: { titulo: 't' } }), 't');
    assert.equal(textoTarea({ ...TAREA, campos: { nombre: 'n' } }), 'n');
    assert.equal(textoTarea({ ...TAREA, campos: { name: 'm' } }), 'm');
  });
  it('sin texto muestra el id, nunca vacio', () => {
    assert.equal(textoTarea({ ...TAREA, campos: {} }), '#9201');
    assert.equal(textoTarea({ ...TAREA, campos: { texto: '  ' } }), '#9201');
  });
});

describe('construirMovimientos', () => {
  it('orden = posicion con proyecto', () => {
    assert.deepEqual(construirMovimientos([{ legacyId: 7 }, { legacyId: 3 }], 9001), [
      { legacyId: 7, orden: 0, proyectoId: 9001 },
      { legacyId: 3, orden: 1, proyectoId: 9001 },
    ]);
  });
});

describe('columnasDeRespuesta (08AA-6, columnas fijas del proxy)', () => {
  it('normaliza proyectos a columnas en orden', () => {
    const got = columnasDeRespuesta({
      proyectos: [
        { clave: 'servicio-api', nombre: 'servicio-api', legacyId: 11 },
        { clave: 'catalogo-web', nombre: 'catalogo-web', legacyId: 12 },
      ],
    });
    assert.deepEqual(got, [
      { clave: 'servicio-api', nombre: 'servicio-api', legacyId: 11 },
      { clave: 'catalogo-web', nombre: 'catalogo-web', legacyId: 12 },
    ]);
  });
  it('descarta rotas y deduplica por clave', () => {
    assert.deepEqual(
      columnasDeRespuesta({
        proyectos: [
          { clave: 'a', nombre: 'A', legacyId: 1 },
          { clave: 'a', nombre: 'A-dup', legacyId: 2 },
          { clave: '', nombre: 'sin-clave', legacyId: 3 },
          { clave: 'b', nombre: '', legacyId: 4 },
          { clave: 'c', nombre: 'C', legacyId: 0 },
          null,
        ],
      }),
      [{ clave: 'a', nombre: 'A', legacyId: 1 }],
    );
    assert.deepEqual(columnasDeRespuesta({}), []);
    assert.deepEqual(columnasDeRespuesta(null), []);
  });
  it('esColumnaTab valida la forma', () => {
    assert.equal(esColumnaTab({ clave: 'a', nombre: 'A', legacyId: 1 }), true);
    assert.equal(esColumnaTab({ clave: 'a', nombre: 'A', legacyId: 0 }), false);
    assert.equal(esColumnaTab(null), false);
  });
});

describe('generarIdTarea (08AA-6, espejo TASKS)', () => {
  it('base ahora*1000 con resto distinto en llamadas seguidas', () => {
    const a = generarIdTarea(1_700_000_000_000);
    const b = generarIdTarea(1_700_000_000_000);
    assert.equal(Math.floor(a / 1000), 1_700_000_000_000);
    assert.notEqual(a, b);
  });
});

describe('parcheConColumna (07AA-15, anti-huerfanas)', () => {
  it('inyecta la columna como proyectoId sin tocar el resto', () => {
    const parche = { texto: 'hola', completado: true };
    assert.deepEqual(parcheConColumna(9505, parche), {
      texto: 'hola',
      completado: true,
      proyectoId: 9505,
    });
    assert.deepEqual(parche, { texto: 'hola', completado: true });
  });
});

describe('niveles (07AA-15, espejo TASKS)', () => {
  it('vocabulario exacto del frente (5 + 4)', () => {
    assert.deepEqual([...PRIORIDADES_TAREA], ['muy_alta', 'alta', 'media', 'baja', 'muy_baja']);
    assert.deepEqual([...URGENCIAS_TAREA], ['bloqueante', 'urgente', 'normal', 'chill']);
    for (const p of PRIORIDADES_TAREA) assert.match(ETIQUETAS_PRIORIDAD[p], /\S/);
    for (const u of URGENCIAS_TAREA) assert.match(ETIQUETAS_URGENCIA[u], /\S/);
  });
  it('lee completado/prioridad/urgencia con defecto honesto', () => {
    const t = tareaDePuente(ITEM_PUENTE)!;
    assert.equal(completadoTarea(t), false);
    assert.equal(prioridadTarea(t), null);
    assert.equal(urgenciaTarea(t), 'normal');
    const hecha: TareaTab = {
      legacyId: 1,
      orden: 0,
      campos: { texto: 'x', completado: true, prioridad: 'alta', urgencia: 'chill' },
    };
    assert.equal(completadoTarea(hecha), true);
    assert.equal(prioridadTarea(hecha), 'alta');
    assert.equal(urgenciaTarea(hecha), 'chill');
    const rota: TareaTab = {
      legacyId: 2,
      orden: 0,
      campos: { completado: 'si', prioridad: 'maxima', urgencia: 'ya' },
    };
    assert.equal(completadoTarea(rota), false);
    assert.equal(prioridadTarea(rota), null);
    assert.equal(urgenciaTarea(rota), 'normal');
  });
});

describe('cacheTareas (08AA-8)', () => {
  const ESTADO = { configurado: true, disponible: true, motivo: null, base: 'http://127.0.0.1:14190' };
  const COLS = [{ clave: 'servicio-api', nombre: 'servicio-api', legacyId: 9001 }];
  const TAREAS = { 9001: [TAREA] };

  it('clonar+restaurar hace roundtrip (via JSON, como localStorage)', () => {
    const foto = clonarCacheTareas(ESTADO, COLS, TAREAS);
    const got = restaurarCacheTareas(JSON.parse(JSON.stringify(foto)));
    assert.deepEqual(got?.columnas, COLS);
    assert.deepEqual(got?.tareas, TAREAS);
    assert.equal(got?.estado.disponible, true);
    assert.equal(got?.estado.base, 'http://127.0.0.1:14190');
  });
  it('una cache vieja (sin base) se restaura sin enlace, no se descarta', () => {
    const vieja = { guardadoEn: 1, estado: { configurado: true, disponible: true, motivo: null }, columnas: [], tareas: {} };
    assert.equal(restaurarCacheTareas(vieja)?.estado.base, null);
  });
  it('clonar filtra tareas invalidas sin romper la foto', () => {
    const foto = clonarCacheTareas(ESTADO, COLS, { 9001: [TAREA, { legacyId: 'x' } as unknown as TareaTab] });
    assert.equal(foto.tareas[9001].length, 1);
  });
  it('restaurar rechaza formas ajenas', () => {
    for (const v of [null, 42, 'x', [], {}, { guardadoEn: 1 }, { guardadoEn: 1, estado: ESTADO }]) {
      assert.equal(restaurarCacheTareas(v), null);
    }
    assert.equal(restaurarCacheTareas({ guardadoEn: 1, estado: ESTADO, columnas: [{ clave: 'a' }], tareas: {} }), null);
    assert.equal(restaurarCacheTareas({ guardadoEn: 1, estado: ESTADO, columnas: [], tareas: { x: [] } }), null);
  });
});

/* Propiedades y subtareas (20AA-10 F4): lo que decide el anidado del kanban y
 * como se teclean las listas del roadmap. */
/* Fabrica de tareas para estas pruebas (id + campos del item). */
const con = (id: number, campos: Record<string, unknown>): TareaTab => ({ legacyId: id, orden: 0, proyectoId: 9001, campos });

describe('arbolDeTareas (F4)', () => {
  const R1 = con(1, { texto: 'padre 1' });
  const R2 = con(2, { texto: 'padre 2' });
  const H1 = con(11, { texto: 'hija de 1', parentId: 1 });
  const H2 = con(12, { texto: 'hija de 1 bis', parentId: 1 });

  it('agrupa las hijas bajo su padre y respeta el orden de la lista', () => {
    const arbol = arbolDeTareas([R1, H1, R2, H2]);
    assert.deepEqual(arbol.map((b) => b.raiz.legacyId), [1, 2]);
    assert.deepEqual(arbol[0].hijas.map((h) => h.legacyId), [11, 12]);
    assert.deepEqual(arbol[1].hijas, []);
  });
  it('un padre que no esta en la lista no se pierde: su hija sale como raiz', () => {
    /* Pasa de verdad al filtrar por columna o al leer una columna a medias: si se descartara, la
     * tarea desapareceria del kanban. */
    const arbol = arbolDeTareas([H1]);
    assert.deepEqual(arbol.map((b) => b.raiz.legacyId), [11]);
  });
  it('sin parentId (null o ausente) es raiz', () => {
    assert.deepEqual(arbolDeTareas([con(1, { texto: 'a', parentId: null })]).length, 1);
    assert.deepEqual(arbolDeTareas([con(1, { texto: 'a' })]).length, 1);
  });
  it('esSubtarea / padreDeTarea leen el parentId real', () => {
    assert.equal(padreDeTarea(H1), 1);
    assert.equal(esSubtarea(H1), true);
    assert.equal(esSubtarea(R1), false);
    assert.equal(padreDeTarea(con(3, { texto: 'x', parentId: 'y' })), null);
  });
});

describe('listas y fechas del roadmap (F4)', () => {
  it('listaTecleada corta por coma, limpia y descarta vacios', () => {
    assert.deepEqual(listaTecleada(' a , b ,, '), ['a', 'b']);
    assert.deepEqual(listaTecleada(''), []);
    /* Una etiqueta puede llevar espacios: no se corta por espacio. */
    assert.deepEqual(listaTecleada('deuda tecnica'), ['deuda tecnica']);
  });
  it('listaATexto es la vuelta', () => {
    assert.equal(listaATexto(['a', 'b']), 'a, b');
    assert.equal(listaATexto([]), '');
  });
  it('fechaValida solo acepta aaaa-mm-dd (lo que escribe el input date)', () => {
    assert.equal(fechaValida('2026-10-20'), '2026-10-20');
    for (const v of ['', '2026-10-2', '20/10/2026', '2026-13-01x', 'hoy']) assert.equal(fechaValida(v), null);
  });
  it('etiquetasTarea / dependeDeTarea / fechasTarea leen lo que dejo el proxy', () => {
    const t = con(1, { texto: 'a', etiquetas: ['x'], dependeDe: ['20AA-8'], creada: '2026-10-01' });
    assert.deepEqual(etiquetasTarea(t), ['x']);
    assert.deepEqual(dependeDeTarea(t), ['20AA-8']);
    assert.equal(fechasTarea(t).creada, '2026-10-01');
    assert.deepEqual(etiquetasTarea(con(2, { texto: 'b' })), []);
    assert.equal(fechasTarea(con(2, { texto: 'b' })).completada, undefined);
  });
});
