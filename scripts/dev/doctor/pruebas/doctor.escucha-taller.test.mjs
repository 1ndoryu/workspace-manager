/* 20AA-33: el mapa no da por muerto un servicio remoto que la 89 sirve solo porque su túnel está
 * cerrado. La escucha de la 89 llega por `snapshot.sistema.taller89` (sonda `ss` por SSH). Puros. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarEntrada } from '../../doctor.mjs';

const proyecto = { clave: 'algo', ruta: 'C:\\area\\algo' };
const vacio = new Map();
const ficha = (puertos) => ({
  id: 'remota',
  host: 'taller',
  boton: [['npm', 'run', 'dev:back']],
  puertos,
  puertosLocales: puertos.map((p) => p + 10000),
  expectedCmdline: 'x',
  healths: puertos.map((p) => ({ puerto: p, ruta: '/' })),
});
/* Escucha con la forma de la sonda `taller-estado`: direccion, puerto, proto. */
const en89 = (puerto, proto = 'tcp') => ({ direccion: '127.0.0.1', puerto, proto });

test('remota servida por la 89 con el túnel cerrado sale `bajo-mando`, y el motivo dice por dónde se miró', async () => {
  const r = await clasificarEntrada(proyecto, ficha([4190]), vacio, vacio, [en89(4190)]);
  assert.equal(r.estado, 'bajo-mando');
  assert.match(r.motivo, /escucha en la 89 por ssh \(ss\), túnel cerrado: 4190/);
});

test('sin lectura de la 89 (null) el túnel cerrado sigue siendo `parado`', async () => {
  const r = await clasificarEntrada(proyecto, ficha([4190]), vacio, vacio, null);
  assert.equal(r.estado, 'parado');
  assert.match(r.motivo, /tunel cerrado \(4190\)/);
});

test('la 89 lectura sin ese puerto: sigue `parado`', async () => {
  const r = await clasificarEntrada(proyecto, ficha([4190]), vacio, vacio, [en89(5555)]);
  assert.equal(r.estado, 'parado');
});

test('un UDP en el mismo número no cuenta como servicio servido', async () => {
  const r = await clasificarEntrada(proyecto, ficha([4190]), vacio, vacio, [en89(4190, 'udp')]);
  assert.equal(r.estado, 'parado');
});

test('servido uno de dos sin túnel: `deriva` por el que no sirve la 89, no verde', async () => {
  const r = await clasificarEntrada(proyecto, ficha([4190, 4191]), vacio, vacio, [en89(4190)]);
  assert.equal(r.estado, 'deriva');
  assert.match(r.motivo, /tunel cerrado \(4191\)/);
});
