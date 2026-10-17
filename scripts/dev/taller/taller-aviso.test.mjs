/* Pruebas del aviso de conformidad del taller (14AA-5), sin red: fetch falso. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisoTaller, resumenTaller } from './taller-aviso.mjs';

const hallazgo = (severidad) => ({ id: 'A1', ambito: 'local', severidad, detalle: 'x', remedio: 'y' });

test('resumen: los errores mandan sobre los avisos; sin hallazgos es conforme', () => {
  assert.match(resumenTaller([hallazgo('error'), hallazgo('advertencia')]), /con errores \(1 error\(es\), 1 aviso\(s\)\)/);
  assert.match(resumenTaller([hallazgo('advertencia')]), /con avisos \(0 error\(es\), 1 aviso\(s\)\)/);
  assert.match(resumenTaller([]), /conforme \(0 error\(es\), 0 aviso\(s\)\)/);
});

test('aviso: manager caído se dice en una línea y no lanza', async () => {
  const lineas = [];
  await avisoTaller({ fetchFn: async () => { throw new Error('fetch failed'); }, log: (l) => lineas.push(l) });
  assert.equal(lineas.length, 1);
  assert.match(lineas[0], /^taller: no consultado \(fetch failed\)/);
});

test('aviso: una respuesta HTTP no válida se dice como no consultado', async () => {
  const lineas = [];
  await avisoTaller({ fetchFn: async () => ({ ok: false, status: 401 }), log: (l) => lineas.push(l) });
  assert.match(lineas[0], /no consultado \(HTTP 401\)/);
});

test('aviso: con datos imprime el veredicto', async () => {
  const lineas = [];
  await avisoTaller({
    fetchFn: async () => ({ ok: true, json: async () => ({ hallazgos: [hallazgo('error')] }) }),
    log: (l) => lineas.push(l),
  });
  assert.match(lineas[0], /^taller: con errores \(1 error\(es\), 0 aviso\(s\)\)/);
});
