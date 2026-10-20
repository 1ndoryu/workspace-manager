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

test('urls: dev en la 89 por el puerto local del túnel y producción por su dominio', () => {
  const registro = {
    proyectos: [
      {
        id: 'TASKS',
        host: 'dev89',
        dominio: 'tareas.localhost',
        modo: 'build',
        puertos: [4190, 4191],
        puertosRemotos: [4190, 4191],
        puertosLocales: [14190, 14191],
        healths: [{ puerto: 4190, ruta: '/api/health' }, { puerto: 4191, ruta: '/' }],
        build: { puertos: [4190], puertosLocales: [14190], healths: [{ puerto: 4190, ruta: '/' }] },
        despliegue: { proveedor: 'coolify', vps: '66', sitio: 'tasks', dominio: 'https://task.nakomi.studio' },
      },
    ],
  };
  const [p] = anotarRegistro([proyecto('TASKS')], registro);
  assert.deepEqual(p.urls, [
    { donde: 'vps89', url: 'http://tareas.localhost:14190' },
    { donde: 'produccion', url: 'https://task.nakomi.studio' },
  ]);
});

test('urls: el puerto de la app es el de la raíz, no el del backend', () => {
  const registro = {
    proyectos: [
      {
        id: 'gloryapi',
        dominio: 'gloryapi.localhost',
        puertos: [3101, 5178],
        healths: [{ puerto: 3101, ruta: '/api/ping' }, { puerto: 5178, ruta: '/' }],
      },
    ],
  };
  const [p] = anotarRegistro([proyecto('gloryapi')], registro);
  assert.deepEqual(p.urls, [{ donde: 'laptop', url: 'http://gloryapi.localhost:5178' }]);
});

test('urls: sin health de raíz manda el último puerto declarado', () => {
  const registro = {
    proyectos: [{ id: 'glory-lab', dominio: 'lab.localhost', puertos: [8791, 5181], healths: [{ puerto: 8791, ruta: '/api/salud' }] }],
  };
  const [p] = anotarRegistro([proyecto('glory-lab')], registro);
  assert.deepEqual(p.urls, [{ donde: 'laptop', url: 'http://lab.localhost:5181' }]);
});

test('urls: ficha sin puertos ni despliegue no inventa ninguna URL', () => {
  const registro = { proyectos: [{ id: 'varsense', host: 'dev89', modo: 'dev' }] };
  const [p] = anotarRegistro([proyecto('varsense')], registro);
  assert.equal(p.urls, undefined);
});
