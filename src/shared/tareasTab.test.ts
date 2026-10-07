/* Puras de la tab tareas (07AA-5 F3): contrato sin React ni red.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/tareasTab.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMNAS_DEFECTO_TAREAS,
  completadoTarea,
  construirMovimientos,
  esTareaTab,
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_URGENCIA,
  normalizarColumnas,
  parsearLegacyId,
  parcheConColumna,
  PRIORIDADES_TAREA,
  prioridadTarea,
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

describe('parsearLegacyId', () => {
  it('acepta entero positivo', () => assert.equal(parsearLegacyId('9001'), 9001));
  it('rechaza basura', () => {
    assert.equal(parsearLegacyId(''), null);
    assert.equal(parsearLegacyId('abc'), null);
    assert.equal(parsearLegacyId('0'), null);
    assert.equal(parsearLegacyId('-5'), null);
    assert.equal(parsearLegacyId('1.5'), null);
  });
});

describe('normalizarColumnas', () => {
  it('filtra y deduplica', () => {
    assert.deepEqual(normalizarColumnas([9001, 'x', 9001, -2, 9002]), [9001, 9002]);
  });
  it('sin nada vuelve al defecto seed F1', () => {
    assert.deepEqual(normalizarColumnas([]), COLUMNAS_DEFECTO_TAREAS);
    assert.deepEqual(normalizarColumnas(null), COLUMNAS_DEFECTO_TAREAS);
    assert.deepEqual(normalizarColumnas(undefined), COLUMNAS_DEFECTO_TAREAS);
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
