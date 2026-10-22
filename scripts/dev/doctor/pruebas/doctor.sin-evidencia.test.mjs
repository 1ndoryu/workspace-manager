/* «Sin evidencia no es verde» (2026-10-22): `bajo-mando` es una AFIRMACION —sondo y respondio
 * 200—, no el punto de partida. Antes, una ficha sin nada que sondear (`sinServicio`, o
 * `puertosRemotos: []`) devolvia `bajo-mando` sin abrir un solo socket, y esos proyectos salian
 * CONECTADOS en el mapa del tablero (caso real: glory-sentinel, varsense, coolify-manager-rs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarEntrada } from '../../doctor.mjs';

const vacio = { porPuerto: new Map(), procs: new Map() };
const proyecto = { clave: 'algo', ruta: 'C:\area\algo' };

test('una ficha sin servicios es `no-aplica`, no `bajo-mando`', async () => {
  const entrada = { id: 'cli', boton: [], puertos: [], expectedCmdline: [], healths: [] };
  const r = await clasificarEntrada(proyecto, entrada, vacio.porPuerto, vacio.procs);
  assert.equal(r.estado, 'no-aplica');
  assert.equal(r.motivo, 'sin-servicio');
});

test('una ficha remota con `puertosRemotos: []` tampoco finge estar viva', async () => {
  const entrada = {
    id: 'remota',
    host: 'taller',
    boton: [['npm', 'run', 'dev:web']],
    puertos: [5180],
    puertosRemotos: [],
    expectedCmdline: 'x',
    healths: [],
  };
  const r = await clasificarEntrada(proyecto, entrada, vacio.porPuerto, vacio.procs);
  assert.equal(r.estado, 'no-aplica');
});

test('remota con túnel cerrado sigue siendo `parado` (no se degradó a no-aplica)', async () => {
  const entrada = {
    id: 'remota',
    host: 'taller',
    boton: [['npm', 'run', 'dev:back']],
    puertos: [4190],
    puertosLocales: [14190],
    expectedCmdline: 'x',
    healths: [{ puerto: 4190, ruta: '/' }],
  };
  const r = await clasificarEntrada(proyecto, entrada, vacio.porPuerto, vacio.procs);
  assert.equal(r.estado, 'parado');
  assert.match(r.motivo, /tunel cerrado \(4190\)/);
});
