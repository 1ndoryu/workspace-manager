/* Puras de la tab tareas (07AA-5 F3): contrato sin React ni red.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/tareasTab.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMNAS_DEFECTO_TAREAS,
  construirMovimientos,
  esTareaTab,
  normalizarColumnas,
  parsearLegacyId,
  tareasDeRespuesta,
  textoTarea,
  type TareaTab,
} from './tareasTab.js';

const TAREA: TareaTab = { legacyId: 9201, orden: 0, proyectoId: 9001, campos: { texto: 'hola' } };

describe('esTareaTab', () => {
  it('acepta la forma del proxy', () => assert.equal(esTareaTab(TAREA), true));
  it('rechaza sin campos', () => assert.equal(esTareaTab({ legacyId: 1, orden: 0 }), false));
  it('rechaza orden no entero', () => assert.equal(esTareaTab({ ...TAREA, orden: 1.5 }), false));
  it('rechaza nulos', () => assert.equal(esTareaTab(null), false));
});

describe('tareasDeRespuesta', () => {
  it('descarta lo que no sea tarea', () => {
    const got = tareasDeRespuesta({ tareas: [TAREA, { legacyId: 'x' }, null, 42] });
    assert.deepEqual(got, [TAREA]);
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
