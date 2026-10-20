/* Pruebas del reductor y del aviso de sincronia de la tab tareas (20AA-10 F5/F6). Sin React ni
 * red: el reductor es puro, asi que se prueba con estados construidos a mano. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ESTADO_INICIAL, avisoDeSincronia, reductor } from './panelTareasEstado.js';
import type { EstadoSincroniaTab } from '../../v2/tareas/apiTareas.js';
import type { TareaTab } from '../../shared/tareas/tareasTab.js';

const tarea = (legacyId: number): TareaTab => ({ legacyId } as unknown as TareaTab);

const sincronia = (extra: Partial<EstadoSincroniaTab> = {}): EstadoSincroniaTab => ({
  activa: true,
  pasadas: 1,
  cuando: null,
  ultimoError: null,
  aplazadas: 0,
  errores: [],
  ...extra,
});

describe('reductor de la tab tareas', () => {
  it('cargado guarda los datos y apaga la carga', () => {
    const prev = { ...ESTADO_INICIAL, cargando: true };
    const s = reductor(prev, { tipo: 'cargado', estado: {} as never, columnas: [], tareas: { 1: [tarea(7)] } });
    assert.equal(s.cargando, false);
    assert.equal(s.tareas[1].length, 1);
  });

  it('fallo limpia el movimiento en curso y el aviso, y deja el error', () => {
    const prev = { ...ESTADO_INICIAL, moviendo: 'x', aviso: 'algo' };
    const s = reductor(prev, { tipo: 'fallo', error: 'boom' });
    assert.equal(s.moviendo, null);
    assert.equal(s.aviso, null);
    assert.equal(s.error, 'boom');
  });

  it('optimista añade la tarea a su columna sin tocar las demas', () => {
    const prev = { ...ESTADO_INICIAL, tareas: { 1: [tarea(1)], 2: [tarea(2)] } };
    const s = reductor(prev, { tipo: 'optimista', columna: 1, tarea: tarea(3) });
    assert.deepEqual(s.tareas[1].map((t) => t.legacyId), [1, 3]);
    assert.equal(s.tareas[2], prev.tareas[2]);
  });

  it('descartar quita solo la tarea con ese legacyId', () => {
    const prev = { ...ESTADO_INICIAL, tareas: { 1: [tarea(1), tarea(2)] } };
    const s = reductor(prev, { tipo: 'descartar', columna: 1, legacyId: 1 });
    assert.deepEqual(s.tareas[1].map((t) => t.legacyId), [2]);
  });

  it('sincronia cambia solo avisoSincronia, no el aviso de un gesto', () => {
    const prev = { ...ESTADO_INICIAL, aviso: 'gesto' };
    const s = reductor(prev, { tipo: 'sincronia', aviso: 'sincronía: x' });
    assert.equal(s.avisoSincronia, 'sincronía: x');
    assert.equal(s.aviso, 'gesto');
  });
});

describe('avisoDeSincronia', () => {
  it('sin nada que decir devuelve null', () => {
    assert.equal(avisoDeSincronia(sincronia()), null);
  });

  it('una pasada fallida se dice con su motivo', () => {
    assert.match(avisoDeSincronia(sincronia({ ultimoError: 'timeout' })) ?? '', /falló \(timeout\)/);
  });

  it('tareas rechazadas cuentan los motivos sin repetirlos', () => {
    const texto = avisoDeSincronia(
      sincronia({
        errores: [
          { proyecto: 'a', motivo: 'sin_titulo' },
          { proyecto: 'b', motivo: 'sin_titulo' },
        ],
      }),
    );
    assert.match(texto ?? '', /2 tarea\(s\) sin escribir en TASK \(sin_titulo\)/);
  });

  it('escrituras aplazadas se dicen aparte', () => {
    assert.match(avisoDeSincronia(sincronia({ aplazadas: 3 })) ?? '', /3 por escribir/);
  });
});
