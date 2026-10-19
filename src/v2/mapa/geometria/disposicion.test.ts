/* Pruebas de disponer: celdas únicas, enlaces por ubicación y producción. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disponer } from './disposicion.js';
import { caraSalida, claveEnlace, rutasDe } from './rutas.js';
import type { Proyecto } from '../../../shared/types.js';

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

test('enlaza solo lo que corre: ejecución en marcha y producción en running', () => {
  const ps = [
    proyecto('a', { ejecucion: { donde: 'vps89', modo: 'build' }, despliegue: coolify }),
    proyecto('b', { ejecucion: { donde: 'laptop', modo: 'dev' } }),
    proyecto('c', { despliegue: coolify }),
  ];
  const { enlaces, hubs } = disponer(ps, new Set(['a']), new Set(['a']));
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

test('un proyecto enlazado a dos nodos se asienta entre ambos, con caras opuestas', () => {
  const ps = [proyecto('puente', { ejecucion: { donde: 'laptop', modo: 'dev' }, despliegue: coolify }), proyecto('otro')];
  const { colocados, hubs, enlaces, troncales } = disponer(ps, new Set(['puente']), new Set(['puente']));
  const c = colocados.find((x) => x.p.id === 'puente')!;
  const l = hubs.find((h) => h.id === 'laptop')!;
  const pr = hubs.find((h) => h.id === 'produccion')!;
  assert.equal(c.col, (l.col + pr.col) / 2);
  assert.equal(c.fila, (l.fila + pr.fila) / 2);
  const rutas = rutasDe(colocados, hubs, enlaces, troncales);
  assert.deepEqual(caraSalida(rutas.get('puente-laptop')!), [-1, 0]);
  assert.deepEqual(caraSalida(rutas.get('puente-produccion')!), [1, 0]);
});

test('los troncales unen laptop con VPS 89 y VPS 89 con producción, sin laptop-producción', () => {
  const { troncales } = disponer([], new Set());
  assert.deepEqual(troncales.map((t) => [t.de, t.a]), [['laptop', 'vps89'], ['vps89', 'produccion']]);
});

test('una caja de frente al nodo se une con un solo tramo recto', () => {
  const ps = [proyecto('kamples', { despliegue: coolify })];
  const { colocados, hubs, enlaces, troncales } = disponer(ps, new Set(), new Set(['kamples']));
  const ruta = rutasDe(colocados, hubs, enlaces, troncales).get('kamples-produccion')!;
  assert.equal(ruta.length, 2);
});

test('las rutas llegan al nodo, salen por caras distintas y no atraviesan otras cajas', () => {
  const ps = Array.from({ length: 12 }, (_, i) =>
    proyecto(`p${i}`, { ejecucion: { donde: i % 2 ? 'vps89' : 'laptop', modo: 'build' }, despliegue: i % 3 ? coolify : undefined }),
  );
  const claves = new Set(ps.map((p) => p.clave));
  const { colocados, hubs, enlaces, troncales } = disponer(ps, claves, claves);
  const rutas = rutasDe(colocados, hubs, enlaces, troncales);
  const cajas = new Set([...colocados, ...hubs].map((c) => `${c.col},${c.fila}`));
  for (const e of enlaces) {
    const r = rutas.get(claveEnlace(e))!;
    const h = hubs.find((x) => x.id === e.hasta)!;
    assert.deepEqual(r[0], { col: e.desde.col, fila: e.desde.fila });
    assert.deepEqual(r[r.length - 1], { col: h.col, fila: h.fila });
    /* Cada tramo es recto por un eje y solo toca celdas de caja en sus extremos. */
    for (let i = 1; i < r.length; i++) assert.ok(r[i].col === r[i - 1].col || r[i].fila === r[i - 1].fila);
    for (const q of r.slice(1, -1)) assert.ok(!cajas.has(`${q.col},${q.fila}`), `${e.clave} cruza una caja`);
    const caras = enlaces.filter((x) => x.clave === e.clave).map((x) => caraSalida(rutas.get(claveEnlace(x))!).join());
    assert.equal(new Set(caras).size, caras.length);
  }
});
