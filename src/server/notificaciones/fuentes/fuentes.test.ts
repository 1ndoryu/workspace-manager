/* Pruebas de las fuentes (20AA-25 N1). Cada una se prueba con datos recortados: lo que importa no
 * es leer el disco ni hablar con TASK, sino que la lista de entidades sea la correcta —porque el
 * motor decide con ella— y que un fallo de lectura no se confunda con «no hay nada». */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Proyecto } from '../../../shared/tipos/proyecto.js';
import type { VpsAgenteContenedor } from '../../../shared/tipos/vps.js';
import type { ProyectoTaller } from '../../../shared/taller/proyecto.js';
import type { GrupoProblemas } from './problemas.js';
import { entidadesDeTareas, fuenteTareas } from './tareas.js';
import { huellaMotivo } from '../../../shared/consola/clasificacionConsola/consola-util.js';
import { entidadesDeProblemas, fuenteProblemas } from './problemas.js';
import { entidadesDeSitios, entidadesDeTaller, fuenteSitios, fuenteTaller } from './servicios.js';

/* Proyecto mínimo: solo lo que la fuente mira. */
function proyectoClave(clave: string, id: string, tareas: { id: string; titulo: string }[] = []): Proyecto {
  return { clave, id, roadmap: { tareas } } as unknown as Proyecto;
}

/* --- tareas -------------------------------------------------------------------------------- */

test('tareas: una entidad por pendiente, con clave proyecto|ID', () => {
  const entidades = entidadesDeTareas([
    proyectoClave('wm', 'workspace-manager', [{ id: '20AA-25', titulo: 'Notificaciones' }]),
    proyectoClave('mn', 'MN', [{ id: 'A-1', titulo: 'Otra' }]),
  ]);
  assert.deepEqual(entidades.map((e) => e.clave), ['wm|20AA-25', 'mn|A-1']);
  assert.equal(entidades[0].titulo, '«Notificaciones»');
  assert.match(entidades[0].detalle, /workspace-manager/);
});

test('tareas: un proyecto sin roadmap no rompe, y el mismo ID en dos proyectos son dos tareas', () => {
  const entidades = entidadesDeTareas([
    proyectoClave('a', 'A', [{ id: 'X', titulo: 'Uno' }]),
    proyectoClave('b', 'B', [{ id: 'X', titulo: 'Dos' }]),
    { clave: 'c', id: 'C' } as unknown as Proyecto,
  ]);
  assert.equal(entidades.length, 2);
  assert.notEqual(entidades[0].clave, entidades[1].clave);
});

test('tareas: un pendiente sin ID no entra (no se podría seguir)', () => {
  const entidades = entidadesDeTareas([proyectoClave('a', 'A', [{ id: '  ', titulo: 'sin id' }])]);
  assert.deepEqual(entidades, []);
});

test('tareas: un título larguísimo se recorta para no engordar el almacén', () => {
  const largo = 'x'.repeat(500);
  const [e] = entidadesDeTareas([proyectoClave('a', 'A', [{ id: '1', titulo: largo }])]);
  assert.ok(e.titulo.length < 100);
  assert.ok(e.titulo.endsWith('»'));
});

test('tareas: si el lector lanza, la fuente lo declara y no devuelve entidades', async () => {
  const f = fuenteTareas(() => Promise.reject(new Error('disco roto')));
  const r = await f.leer();
  assert.deepEqual(r.entidades, []);
  assert.match(r.problema ?? '', /disco roto/);
  assert.equal(r.sinLectura, true, 'sin lectura, el motor no puede dar nada por desaparecido');
});

/* --- problemas ----------------------------------------------------------------------------- */

function grupo(clave: string, id: string, entradas: GrupoProblemas['entradas']): GrupoProblemas {
  return { clave, id, entradas };
}

test('problemas: clave estable aunque cambie un contador o se reordenen las líneas', () => {
  const a = entidadesDeProblemas([
    grupo('wm', 'workspace-manager', [{ categoria: 'sinPush', motivo: '3 commit(s) sin push', seriedad: null }]),
  ]);
  const b = entidadesDeProblemas([
    grupo('wm', 'workspace-manager', [{ categoria: 'sinPush', motivo: '7 commit(s) sin push', seriedad: null }]),
  ]);
  assert.equal(a[0].clave, b[0].clave);
});

test('problemas: un paquete distinto es un problema distinto', () => {
  const [e] = entidadesDeProblemas([
    grupo('wm', 'wm', [{ categoria: 'vulnerabilidad', motivo: 'lodash (npm) — high', seriedad: null }]),
  ]);
  const [o] = entidadesDeProblemas([
    grupo('wm', 'wm', [{ categoria: 'vulnerabilidad', motivo: 'axios (npm) — high', seriedad: null }]),
  ]);
  assert.notEqual(e.clave, o.clave);
});

test('problemas: pendientes y dev no generan avisos (ya tienen su fuente o su panel)', () => {
  const entidades = entidadesDeProblemas([
    grupo('wm', 'wm', [
      { categoria: 'pendiente', motivo: '20AA-1 — Título', seriedad: null },
      { categoria: 'dev', motivo: 'dev deriva: exe ausente', seriedad: 'error' },
      { categoria: 'taller', motivo: 'T9 conciliación', seriedad: 'advertencia' },
      { categoria: 'config', motivo: 'falta una opción', seriedad: 'error' },
    ]),
  ]);
  assert.deepEqual(entidades.map((e) => e.clave.split('|')[1]), ['config']);
});

test('problemas: la misma huella dos veces en el mismo grupo se anuncia una vez', () => {
  const entidades = entidadesDeProblemas([
    grupo('wm', 'wm', [
      { categoria: 'sentinel', motivo: 'src/a.ts:12 — X — misma', seriedad: null },
      { categoria: 'sentinel', motivo: 'src/a.ts:99 — X — misma', seriedad: null },
    ]),
  ]);
  assert.equal(entidades.length, 1);
});

test('problemas: la huella quita números, mayúsculas y acentos', () => {
  assert.equal(huellaMotivo('Puerto 5175 Ocupado'), huellaMotivo('puerto 14190 ocupado'));
  assert.notEqual(huellaMotivo('puerto ocupado'), huellaMotivo('puerto libre'));
});

test('problemas: sin consola, la fuente lo declara y no toca la memoria del motor', async () => {
  const r = await fuenteProblemas(() => Promise.reject(new Error('sin snapshot'))).leer();
  assert.deepEqual(r.entidades, []);
  assert.match(r.problema ?? '', /sin snapshot/);
  /* [por que] Leer «nada» no es leer «cero problemas»: sin esto el motor anunciaba resueltos. */
  assert.equal(r.sinLectura, true);
});

test('problemas: un proyecto sin análisis vigente no cuenta como problema resuelto', async () => {
  const r = await fuenteProblemas(async () => ({
    grupos: [grupo('wm', 'wm', [{ categoria: 'sentinel', motivo: 'a.ts:1 — X — roto', seriedad: null }])],
    sinVer: ['PROYECTO|'],
  })).leer();
  assert.equal(r.entidades.length, 1);
  assert.deepEqual(r.sinVer, ['PROYECTO|']);
  assert.equal(r.sinLectura, undefined);
});

/* --- sitios (producción) -------------------------------------------------------------------- */

function sitio(nombre: string, estadoReal: string) {
  return { nombre, dominio: `${nombre}.test`, target: '', uuid: 'u', estadoReal };
}

test('sitios: entran los que sirven (running y degraded), no los caídos ni los dudosos', () => {
  const entidades = entidadesDeSitios({
    sitios: [sitio('vivo', 'running:healthy'), sitio('degradado', 'degraded:unhealthy'), sitio('parado', 'exited'), sitio('dudoso', 'desconocido')],
    sinLectura: null,
  });
  assert.deepEqual(entidades.map((e) => e.clave), ['sitio:vivo', 'sitio:degradado']);
});

test('sitios: sin lectura no se declara nada (ni entidades ni caídas)', async () => {
  const r = await fuenteSitios(() =>
    Promise.resolve({ sitios: [], sinLectura: 'no se pudo leer el listado (¿VPS inalcanzable?)' }),
  ).leer();
  assert.deepEqual(r.entidades, []);
  assert.match(r.problema ?? '', /VPS inalcanzable/);
  assert.equal(r.sinLectura, true);
});

test('sitios: una lista vacía y una lectura rota se distinguen', async () => {
  const vacia = await fuenteSitios(() => Promise.resolve({ sitios: [], sinLectura: null })).leer();
  assert.deepEqual(vacia.entidades, []);
  assert.equal(vacia.problema, null, 'lista vacía es un dato: no hay ningún sitio vivo');
  assert.equal(vacia.sinLectura, undefined, 'una lista vacía no es una lectura rota');
});

/* --- taller (89) --------------------------------------------------------------------------- */

function contenedor(nombre: string, estado: string): VpsAgenteContenedor {
  return {
    id: `${nombre}-${estado}`, nombre, estado, imagen: 'i', cpuPct: 0, memMiB: 0, memLimiteMiB: null,
    redRxBytes: 0, redTxBytes: 0, blkReadBytes: 0, blkWriteBytes: 0, sitioUuid: null, dominio: null,
  } as VpsAgenteContenedor;
}

const PROYECTOS: ProyectoTaller[] = [
  { id: 'proyecto-a', sesiones: ['dev-proyecto-a-4190'], puertoLocal: 14190, hostname: 'a.test' },
  { id: 'proyecto-b', sesiones: ['dev-proyecto-b-4191'], puertoLocal: 14191, hostname: null },
];

test('taller: vivo el que tiene algún proceso arriba; el parado no entra', () => {
  const entidades = entidadesDeTaller([contenedor('proyecto-a', 'running')], PROYECTOS);
  assert.deepEqual(entidades.map((e) => e.clave), ['taller:proyecto-a']);
  assert.equal(entidades[0].titulo, 'proyecto del taller: proyecto-a');
  assert.equal(entidades[0].detalle, 'a.test');
});

test('taller: un proyecto con un proceso caído y otro vivo sigue arriba', () => {
  const entidades = entidadesDeTaller(
    [contenedor('proyecto-a', 'exited'), contenedor('proyecto-a', 'running')],
    PROYECTOS,
  );
  assert.deepEqual(entidades.map((e) => e.clave), ['taller:proyecto-a']);
});

test('taller: un proceso vivo que no está en el registro también cuenta', () => {
  const entidades = entidadesDeTaller([contenedor('suelto', 'running')], PROYECTOS);
  assert.deepEqual(entidades.map((e) => e.clave), ['taller:suelto']);
  assert.equal(entidades[0].detalle, 'sin hostname en el taller');
});

test('taller: sin pulse configurado lo dice y no anuncia caídas', async () => {
  const r = await fuenteTaller(() =>
    Promise.resolve({ disponible: false, contenedores: [], proyectos: PROYECTOS, error: 'sin-configurar' }),
  ).leer();
  assert.deepEqual(r.entidades, []);
  assert.match(r.problema ?? '', /sin pulse/);
  assert.equal(r.sinLectura, true, 'sin pulse no se sabe nada del taller, ni siquiera que esté vacío');
});

test('taller: un error del agente se anota pero los datos que lleguen valen', async () => {
  const r = await fuenteTaller(() =>
    Promise.resolve({
      disponible: true,
      contenedores: [contenedor('proyecto-a', 'running')],
      proyectos: PROYECTOS,
      error: 'pulse-timeout',
    }),
  ).leer();
  assert.equal(r.entidades.length, 1);
  assert.match(r.problema ?? '', /pulse-timeout/);
});
