/* Pruebas de disponer: celdas únicas, enlaces por ubicación y producción. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disponer } from './disposicion.js';
import type { Proyecto } from '../../shared/types.js';

function proyecto(id: string, extra: Partial<Proyecto> = {}): Proyecto {
  return { id, clave: id, ruta: `/area/${id}`, esGit: true, tipo: 'repo', ...extra };
}

const coolify = { proveedor: 'coolify', vps: '66', sitio: 's', dominio: 'https://s.dev' } as const;

test('cada proyecto ocupa una celda propia y distinta de los nodos', () => {
  const ps = Array.from({ length: 40 }, (_, i) =>
    proyecto(`p${i}`, i % 2 ? { ejecucion: { donde: 'vps89', modo: 'build' } } : {}),
  );
  const { colocados, hubs } = disponer(ps, new Set(ps.map((p) => p.clave)));
  const celdas = new Set([...colocados, ...hubs].map((c) => `${c.col},${c.fila}`));
  assert.equal(colocados.length, 40);
  assert.equal(celdas.size, 40 + hubs.length);
});

test('enlaza solo lo que corre: ejecución en marcha y despliegue', () => {
  const ps = [
    proyecto('a', { ejecucion: { donde: 'vps89', modo: 'build' }, despliegue: coolify }),
    proyecto('b', { ejecucion: { donde: 'laptop', modo: 'dev' } }),
    proyecto('c'),
  ];
  const { enlaces, hubs } = disponer(ps, new Set(['a']));
  /* b está apagado: sin enlace. */
  assert.deepEqual(
    enlaces.map((e) => [e.clave, e.hasta, e.tipo, e.vivo]),
    [
      ['a', 'vps89', 'ejecucion', true],
      ['a', 'produccion', 'produccion', true],
    ],
  );
  assert.equal(hubs.find((h) => h.id === 'produccion')?.total, 1);
});

test('el reparto es estable entre ejecuciones', () => {
  const ps = [proyecto('x', { ejecucion: { donde: 'laptop', modo: null } }), proyecto('y')];
  assert.deepEqual(disponer(ps, new Set()), disponer(ps, new Set()));
});
