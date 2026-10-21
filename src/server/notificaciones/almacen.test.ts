/* Pruebas del almacén de notificaciones (20AA-25 N0). Se usa un fichero temporal por prueba: lo
 * que se comprueba es el contrato con el disco (tope, retención, tolerancia a un fichero roto) y
 * que la escritura agrupada no pierda nada. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Aviso } from '../../shared/notificaciones/tipos.js';
import { RETENCION_MS, TOPE_AVISOS, crearAlmacenNotificaciones } from './almacen.js';
import { estadoMotorInicial } from './motor.js';

/* Carpeta aislada por prueba; se borra al terminar. */
function enTemporal(): { ruta: string; limpiar: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'notificaciones-'));
  /* La subcarpeta existe de antemano: las pruebas escriben a veces antes de que el almacén cree. */
  mkdirSync(join(dir, 'cache'));
  return { ruta: join(dir, 'cache', 'notificaciones.json'), limpiar: () => rmSync(dir, { recursive: true, force: true }) };
}

const AHORA = Date.parse('2026-10-21T12:00:00.000Z');

function aviso(id: number, cuando = new Date(AHORA).toISOString()): Aviso {
  return {
    id,
    tipo: 'tarea-nueva',
    nivel: 'media',
    titulo: `Aviso ${id}`,
    detalle: '',
    fuente: 'tareas',
    clave: `t-${id}`,
    cuando,
    agrupados: 1,
    leido: false,
  };
}

test('arranca vacío si el fichero no existe, sin avisar', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    const e = a.estado();
    assert.deepEqual(e.avisos, []);
    assert.deepEqual(e.fuentesRotas, []);
    assert.equal(e.pasadaEn, null);
    assert.deepEqual(a.motor(), estadoMotorInicial());
  } finally {
    limpiar();
  }
});

test('los avisos nuevos entran delante y sobreviven a un reinicio', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    a.anadir([aviso(1)]);
    a.anadir([aviso(2)]);
    a.volcar();
    assert.deepEqual(a.estado().avisos.map((x) => x.id), [2, 1]);

    const b = crearAlmacenNotificaciones(ruta, () => AHORA);
    assert.deepEqual(b.estado().avisos.map((x) => x.id), [2, 1]);
  } finally {
    limpiar();
  }
});

test('el tope se respeta cortando por lo más viejo', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    /* Un aviso por llamada, para que el tope actúe varias veces y no sólo al final. */
    for (let i = 1; i <= TOPE_AVISOS + 25; i += 1) a.anadir([aviso(i)]);
    const ids = a.estado().avisos.map((x) => x.id);
    assert.equal(ids.length, TOPE_AVISOS);
    assert.equal(ids[0], TOPE_AVISOS + 25, 'el más nuevo se conserva');
    assert.ok(!ids.includes(1), 'el más viejo se ha podado');
  } finally {
    limpiar();
  }
});

test('lo que supera la retención se poda aunque no se llegue al tope', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const viejo = new Date(AHORA - RETENCION_MS - 1000).toISOString();
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    a.anadir([aviso(1, viejo), aviso(2)]);
    assert.deepEqual(a.estado().avisos.map((x) => x.id), [2]);
  } finally {
    limpiar();
  }
});

test('marcar leídos: todos o sólo los indicados, y persiste', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    a.anadir([aviso(1), aviso(2), aviso(3)]);
    a.marcarLeidos([2]);
    assert.deepEqual(a.estado().avisos.filter((x) => x.leido).map((x) => x.id), [2]);
    a.marcarLeidos();
    assert.ok(a.estado().avisos.every((x) => x.leido));
    a.volcar();

    const b = crearAlmacenNotificaciones(ruta, () => AHORA);
    assert.ok(b.estado().avisos.every((x) => x.leido), 'lo leído no puede volver a no leído tras reiniciar');
  } finally {
    limpiar();
  }
});

test('silenciar guarda la lista sin duplicados', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    a.silenciar(['tarea-nueva', 'tarea-nueva', 'sitio-caido']);
    assert.deepEqual(a.estado().preferencias.silenciados, ['tarea-nueva', 'sitio-caido']);
    a.volcar();
    const b = crearAlmacenNotificaciones(ruta, () => AHORA);
    assert.deepEqual(b.estado().preferencias.silenciados, ['tarea-nueva', 'sitio-caido']);
  } finally {
    limpiar();
  }
});

test('la memoria del motor y la última pasada se conservan', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    const motor = { ...estadoMotorInicial(), memorias: { tareas: { a: { titulo: 'A', detalle: 'p' } } }, ultimoId: 7 };
    a.guardarPasada(motor, '2026-10-21T11:59:00.000Z', [{ fuente: 'sitios', problema: 'timeout' }]);
    a.volcar();
    const b = crearAlmacenNotificaciones(ruta, () => AHORA);
    assert.equal(b.motor().ultimoId, 7);
    assert.equal(b.estado().pasadaEn, '2026-10-21T11:59:00.000Z');
    assert.deepEqual(b.estado().fuentesRotas, [{ fuente: 'sitios', problema: 'timeout' }]);
  } finally {
    limpiar();
  }
});

test('un fichero corrupto arranca vacío en vez de romper el servidor', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const base = crearAlmacenNotificaciones(ruta, () => AHORA);
    base.silenciar(['sitio-caido']);
    base.volcar();
    writeFileSync(ruta, '{ esto no es json', 'utf8');

    const avisos: string[] = [];
    const escuchar = (w: Error): void => void avisos.push(w.message);
    process.on('warning', escuchar);
    try {
      const b = crearAlmacenNotificaciones(ruta, () => AHORA);
      assert.deepEqual(b.estado().avisos, []);
      assert.deepEqual(b.motor(), estadoMotorInicial());
    } finally {
      process.off('warning', escuchar);
    }
  } finally {
    limpiar();
  }
});

test('avisos con forma inválida en el fichero se descartan, los buenos se quedan', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const bueno = aviso(1);
    writeFileSync(
      ruta,
      JSON.stringify({
        version: 1,
        motor: { memorias: { tareas: { x: { titulo: 'X', detalle: '' }, roto: null } }, amortiguaciones: {}, ultimoId: 1 },
        avisos: [bueno, { id: 'no-numero' }, { id: 9, tipo: 'inventado' }],
        preferencias: { silenciados: ['sitio-caido', 42] },
        pasadaEn: null,
        fuentesRotas: [{ fuente: 'x' }],
      }),
      'utf8',
    );
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    assert.deepEqual(a.estado().avisos.map((x) => x.id), [1]);
    assert.deepEqual(a.estado().preferencias.silenciados, ['sitio-caido']);
    assert.deepEqual(a.estado().fuentesRotas, []);
    assert.deepEqual(Object.keys(a.motor().memorias.tareas), ['x']);
  } finally {
    limpiar();
  }
});

test('la escritura se agrupa: varias mutaciones, una sola escritura al volcar', () => {
  const { ruta, limpiar } = enTemporal();
  try {
    const a = crearAlmacenNotificaciones(ruta, () => AHORA);
    a.anadir([aviso(1)]);
    a.anadir([aviso(2)]);
    a.marcarLeidos([2]);
    /* Nada en disco hasta que se fuerza: eso es la agrupación. */
    assert.throws(() => readFileSync(ruta, 'utf8'));
    a.volcar();
    const enDisco = JSON.parse(readFileSync(ruta, 'utf8')) as { avisos: Aviso[] };
    assert.deepEqual(enDisco.avisos.map((x) => x.id), [2, 1]);
    assert.equal(enDisco.avisos[0].leido, true);
  } finally {
    limpiar();
  }
});
