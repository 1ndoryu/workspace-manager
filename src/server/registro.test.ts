/* Pruebas de anotarRegistro: vincula cada proyecto con su ficha del registro. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anotarRegistro } from './registro.js';
import type { Proyecto } from '../shared/tipos/proyecto.js';

function proyecto(id: string): Proyecto {
  return { id, clave: id, ruta: `/area/${id}`, esGit: true, tipo: 'repo' };
}

test('ficha con host de la 89 y modo build: corre en vps89 y lleva despliegue', () => {
  const registro = {
    proyectos: [
      {
        id: 'NAKOMI',
        host: 'dev89',
        modo: 'build',
        despliegue: { proveedor: 'coolify', vps: '66', sitio: 'nakomi', dominio: 'https://task.nakomi.studio' },
      },
    ],
  };
  const [p] = anotarRegistro([proyecto('NAKOMI')], registro);
  assert.deepEqual(p.ejecucion, { donde: 'vps89', modo: 'build' });
  assert.equal(p.despliegue?.sitio, 'nakomi');
});

test('ficha sin host corre en el laptop; modo desconocido queda null', () => {
  const registro = { proyectos: [{ id: 'glory-pulse', buildMode: 'raro' }] };
  const [p] = anotarRegistro([proyecto('glory-pulse')], registro);
  assert.deepEqual(p.ejecucion, { donde: 'laptop', modo: null });
  assert.equal(p.despliegue, undefined);
});

test('proyecto sin ficha queda intacto', () => {
  const original = proyecto('suelto');
  const [p] = anotarRegistro([original], { proyectos: [{ id: 'otro', host: 'dev89' }] });
  assert.equal(p.ejecucion, undefined);
  assert.equal(p.despliegue, undefined);
});

test('sin registro (proyectos ausente) no añade vínculos', () => {
  const [p] = anotarRegistro([proyecto('x')], {});
  assert.equal(p.ejecucion, undefined);
});
