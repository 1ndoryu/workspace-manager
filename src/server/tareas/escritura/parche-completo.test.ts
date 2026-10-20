/* Parche completado antes del PUT a TASK (20AA-10).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/tareas/escritura/parche-completo.test.ts
 * [por que] Aqui se prueba lo que impide que una edicion desde el tab borre el espejo del roadmap y
 * saque la tarjeta de su columna. Si esto se rompe, no falla nada visible: la sincronizacion con el
 * archivo deja de funcionar sin decir nada. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completarParche, payloadGuardado } from './parche-completo.js';

/* Un item de TASK tal como lo sirve la API: payload mezclado a raiz. */
const item = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1792498600672672,
  texto: 'Re-verificar el tag exacto del proxy.',
  completado: false,
  prioridad: null,
  urgencia: 'normal',
  proyectoId: 1791434316757757,
  parentId: null,
  orden: 3,
  updatedAt: '2026-10-20T12:22:57.480430Z',
  roadmap: { id: '19AA-1', huella: 'd5c2dc5c63a386dc', espejo: { texto: 'Re-verificar el tag exacto del proxy.' } },
  ...extra,
});

describe('payloadGuardado', () => {
  it('conserva el espejo del roadmap y no mete las claves de TASK ni la fecha de fila', () => {
    const p = payloadGuardado(item());
    assert.deepEqual(Object.keys(p).sort(), ['roadmap']);
    assert.equal((p.roadmap as Record<string, unknown>).id, '19AA-1');
  });

  it('conserva claves propias que no son nuestras', () => {
    const p = payloadGuardado(item({ asignadoA: 'cae33c86', etiquetas: ['sync'] }));
    assert.deepEqual(Object.keys(p).sort(), ['asignadoA', 'etiquetas', 'roadmap']);
  });
});

describe('completarParche', () => {
  it('una edicion que solo toca la prioridad no borra nada', () => {
    const completo = completarParche(item(), { texto: 'Re-verificar el tag exacto del proxy.', prioridad: 'alta' });
    assert.equal(completo.prioridad, 'alta');
    assert.equal(completo.proyectoId, 1791434316757757);
    assert.equal(completo.orden, 3);
    assert.equal(completo.completado, false);
    assert.equal(completo.urgencia, 'normal');
    assert.equal((completo.payload?.roadmap as Record<string, unknown>).id, '19AA-1');
  });

  it('conserva el parentId: editar una subtarea no la convierte en raiz', () => {
    const completo = completarParche(item({ parentId: 1792498600672670 }), { texto: 'Sub.', prioridad: 'baja' });
    assert.equal(completo.parentId, 1792498600672670);
  });

  it('lo que el parche dice manda, tambien cuando dice null o false', () => {
    const completo = completarParche(item({ prioridad: 'alta', completado: true }), {
      texto: 'Re-verificar el tag exacto del proxy.',
      prioridad: null,
      completado: false,
    });
    assert.equal(completo.prioridad, null);
    assert.equal(completo.completado, false);
  });

  it('el payload del llamante, si lo manda, no se mezcla ni se pisa', () => {
    const mio = { roadmap: { id: '19AA-1', huella: 'nueva' } };
    const completo = completarParche(item(), { texto: 'Re-verificar el tag exacto del proxy.', payload: mio });
    assert.deepEqual(completo.payload, mio);
  });

  it('el expectedUpdatedAt viaja si venia, y no se inventa si no', () => {
    const con = completarParche(item(), { texto: 'x', expectedUpdatedAt: '2026-10-20T12:00:00.000Z' });
    assert.equal(con.expectedUpdatedAt, '2026-10-20T12:00:00.000Z');
    assert.equal('expectedUpdatedAt' in completarParche(item(), { texto: 'x' }), false);
  });

  it('con un item sin urgencia cae a «normal», que es el defecto de TASK', () => {
    const completo = completarParche(item({ urgencia: undefined }), { texto: 'x' });
    assert.equal(completo.urgencia, 'normal');
  });
});
