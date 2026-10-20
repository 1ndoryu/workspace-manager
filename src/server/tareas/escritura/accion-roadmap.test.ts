/* Acciones del tab sobre el roadmap (20AA-10 F3b).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/tareas/escritura/accion-roadmap.test.ts
 * [por que] Son las unicas rutas por las que pulsar en la tab escribe dentro del proyecto de otro.
 * Se prueba contra un directorio temporal: ni se toca un proyecto de verdad ni se ensucia el area. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analizarRoadmap } from '../../scanner/roadmap/roadmap.js';
import type { EspejoContenido } from './contenido-tarea.js';
import { borrarDelRoadmap, cerrarEnRoadmap, crearEnRoadmap, editarEnRoadmap, reabrirEnRoadmap, reordenarRoadmap, type DepsAccionRoadmap, type ProyectoRoadmap } from './accion-roadmap.js';

const T = Date.parse('2026-10-20T12:00:00.000Z');

const CUERPO = [
  '## Pendientes',
  '',
  '- [ ] `20AA-1` — **Primera.**',
  '  · prioridad: alta',
  '  - [ ] **Su subtarea.**',
  '',
  '- [ ] `20AA-2` — **Segunda.**',
  '',
  '## Bloqueos',
  '',
  '- Nada.',
  '',
].join('\n');

interface Taller {
  raiz: string;
  proyecto: ProyectoRoadmap;
  deps: DepsAccionRoadmap;
  leer: () => string;
  historial: () => Record<string, unknown>[];
  copias: () => string[];
}

function taller(texto: string = CUERPO): Taller {
  const raiz = mkdtempSync(join(tmpdir(), 'wm-accion-'));
  const ruta = join(raiz, 'proyecto');
  mkdirSync(ruta, { recursive: true });
  writeFileSync(join(ruta, 'roadmap.md'), texto, 'utf8');
  const proyecto: ProyectoRoadmap = { clave: 'proyecto', nombre: 'Proyecto', ruta };
  return {
    raiz,
    proyecto,
    deps: { raizRepo: raiz, ahora: () => T },
    leer: () => readFileSync(join(ruta, 'roadmap.md'), 'utf8'),
    historial: () =>
      readFileSync(join(raiz, 'data', 'historial-roadmap', 'proyecto.ndjson'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    copias: () => readdirSync(join(raiz, 'data', 'respaldos-roadmap', 'proyecto')),
  };
}

const sinProps = (texto: string): EspejoContenido => ({
  texto,
  prioridad: null,
  urgencia: null,
  etiquetas: [],
  dependeDe: [],
  fechas: {},
});

void describe('accion-roadmap', () => {
  void it('crear reparte el ID, escribe la linea en Pendientes y deja copia e historial', () => {
    const t = taller();
    const r = crearEnRoadmap(t.deps, t.proyecto, { texto: 'Tercera.', propiedades: { prioridad: 'alta' } });
    assert.equal(r.id, '20AA-3');
    assert.equal(r.linea, 9);
    assert.equal(r.escribio, true);
    assert.equal(r.aviso, null);
    assert.deepEqual(t.leer().split('\n'), [
      '## Pendientes',
      '',
      '- [ ] `20AA-1` — **Primera.**',
      '  · prioridad: alta',
      '  - [ ] **Su subtarea.**',
      '',
      '- [ ] `20AA-2` — **Segunda.**',
      '',
      '- [ ] `20AA-3` — **Tercera.**',
      '  · prioridad: alta',
      '',
      '## Bloqueos',
      '',
      '- Nada.',
      '',
    ]);
    /* La copia es del archivo de antes, y el historial dice que paso y donde. */
    assert.equal(t.copias().length, 1);
    assert.equal(readFileSync(join(t.raiz, 'data', 'respaldos-roadmap', 'proyecto', t.copias()[0] ?? ''), 'utf8'), CUERPO);
    assert.deepEqual(t.historial()[0], {
      at: '2026-10-20T12:00:00.000Z',
      tarea: '20AA-3',
      origen: 'task',
      campo: 'crear',
      antes: null,
      despues: 'Tercera.',
      sitio: 'roadmap.md:9',
      autor: 'puente',
    });
  });

  void it('crear sin la seccion de pendientes no inventa la seccion ni escribe nada', () => {
    const t = taller('## Bloqueos\n\n- Nada.\n');
    const r = crearEnRoadmap(t.deps, t.proyecto, { texto: 'Tercera.', propiedades: {} });
    assert.equal(r.escribio, false);
    assert.equal(r.copia, null);
    assert.match(r.aviso ?? '', /^sin-seccion-Pendientes/);
    assert.equal(t.leer(), '## Bloqueos\n\n- Nada.\n');
    assert.equal(existsSync(join(t.raiz, 'data')), false);
  });

  void it('sin roadmap no se toca nada y el aviso lo dice', () => {
    const t = taller();
    const p: ProyectoRoadmap = { clave: 'otro', nombre: 'Otro', ruta: join(t.raiz, 'no-existe') };
    assert.match(borrarDelRoadmap(t.deps, p, '20AA-1').aviso ?? '', /^sin-roadmap/);
  });

  void it('editar reescribe el titulo, quita la linea de propiedades y lo anota campo a campo', () => {
    const t = taller();
    const r = editarEnRoadmap(t.deps, t.proyecto, '20AA-1', sinProps('Primera cambiada.'));
    assert.equal(r.escribio, true);
    assert.deepEqual(
      r.cambios.map((c) => `${c.campo}: ${c.antes} -> ${c.despues}`),
      ['texto: Primera. -> Primera cambiada.', 'prioridad: alta -> null'],
    );
    assert.deepEqual(t.leer().split('\n').slice(0, 5), [
      '## Pendientes',
      '',
      '- [ ] `20AA-1` — **Primera cambiada.**',
      '  - [ ] **Su subtarea.**',
      '',
    ]);
    /* La subtarea se queda: editar el titulo no toca el cuerpo de la tarea. */
    assert.equal(analizarRoadmap(t.leer()).tareas[0]?.subtareas.length, 1);
  });

  void it('editar sin diferencias no escribe el archivo', () => {
    const t = taller();
    const r = editarEnRoadmap(t.deps, t.proyecto, '20AA-1', { ...sinProps('Primera.'), prioridad: 'alta' });
    assert.equal(r.escribio, false);
    assert.equal(r.aviso, 'sin-cambios');
    assert.equal(t.leer(), CUERPO);
  });

  void it('editar una tarea que no esta en el roadmap lo dice, no la crea', () => {
    const t = taller();
    const r = editarEnRoadmap(t.deps, t.proyecto, '20AA-9', sinProps('Otra.'));
    assert.equal(r.escribio, false);
    assert.equal(r.aviso, 'no-esta-en-el-roadmap');
    assert.equal(t.leer(), CUERPO);
  });

  void it('borrar se lleva el bloque entero y anota tambien las subtareas que habia', () => {
    const t = taller();
    const r = borrarDelRoadmap(t.deps, t.proyecto, '20AA-1');
    assert.equal(r.escribio, true);
    assert.deepEqual(
      r.cambios.map((c) => `${c.campo}: ${c.antes}`),
      ['borrar: Primera.', 'subtarea-borrada: Su subtarea.'],
    );
    assert.deepEqual(t.leer().split('\n'), ['## Pendientes', '', '- [ ] `20AA-2` — **Segunda.**', '', '## Bloqueos', '', '- Nada.', '']);
  });

  void it('cerrar saca la tarea del roadmap y la deja en el registro de completados', () => {
    const t = taller();
    const r = cerrarEnRoadmap(t.deps, t.proyecto, '20AA-1', 'Primera.');
    assert.equal(r.escribio, true);
    assert.equal(r.aviso, null);
    assert.equal(analizarRoadmap(t.leer()).tareas.some((x) => x.id === '20AA-1'), false);
    assert.equal(
      readFileSync(join(t.proyecto.ruta, 'Agente', 'completados', 'tareas-2026-10-20.md'), 'utf8'),
      '# Tareas completadas — 2026-10-20\n\n- **20AA-1 · Primera.** Cerrada desde el tab (TASK), 2026-10-20.\n',
    );
  });

  void it('cerrar una segunda tarea el mismo dia aprovecha el registro, sin repetir la cabecera', () => {
    const t = taller();
    cerrarEnRoadmap(t.deps, t.proyecto, '20AA-1', 'Primera.');
    cerrarEnRoadmap(t.deps, t.proyecto, '20AA-2', 'Segunda.');
    const registro = readFileSync(join(t.proyecto.ruta, 'Agente', 'completados', 'tareas-2026-10-20.md'), 'utf8');
    assert.equal(registro.match(/# Tareas completadas/g)?.length, 1);
    assert.equal(registro.split('\n').filter((l) => l.startsWith('- **')).length, 2);
  });

  void it('reabrir devuelve la tarea al roadmap con su mismo ID', () => {
    const t = taller();
    cerrarEnRoadmap(t.deps, t.proyecto, '20AA-1', 'Primera.');
    const r = reabrirEnRoadmap(t.deps, t.proyecto, '20AA-1', 'Primera.', { prioridad: 'alta' });
    assert.equal(r.escribio, true);
    assert.equal(r.linea, 5);
    assert.deepEqual(t.leer().split('\n').slice(4, 7), ['- [ ] `20AA-1` — **Primera.**', '  · prioridad: alta', '']);
    /* Y una segunda reapertura no duplica: si ya esta, no se toca. */
    assert.equal(reabrirEnRoadmap(t.deps, t.proyecto, '20AA-1', 'Primera.', {}).aviso, 'ya-esta-en-el-roadmap');
  });

  void it('reabrir limpia su entrada del registro de completados, aunque sea de otro dia', () => {
    const t = taller();
    /* Cerrada ayer y reabierta hoy: la entrada vive en el archivo de ayer, no en el de hoy. */
    cerrarEnRoadmap(t.deps, t.proyecto, '20AA-1', 'Primera.');
    const carpeta = join(t.proyecto.ruta, 'Agente', 'completados');
    unlinkSync(join(carpeta, 'tareas-2026-10-20.md'));
    const ayer = join(carpeta, 'tareas-2026-10-19.md');
    writeFileSync(
      ayer,
      '# Tareas completadas — 2026-10-19\n\n- **20AA-1 · Primera.** Cerrada desde el tab (TASK), 2026-10-19.\n- **19AA-9 · Otra.** Cerrada desde el tab (TASK), 2026-10-19.\n',
      'utf8',
    );
    const r = reabrirEnRoadmap(t.deps, t.proyecto, '20AA-1', 'Primera.', {});
    assert.equal(r.escribio, true);
    assert.equal(r.aviso, null);
    /* Se va su linea y solo la suya: la de la otra tarea sigue donde estaba. */
    assert.equal(readFileSync(ayer, 'utf8'), '# Tareas completadas — 2026-10-19\n\n- **19AA-9 · Otra.** Cerrada desde el tab (TASK), 2026-10-19.\n');
    /* El rastro de la limpieza queda en el historial, con el archivo y la linea de donde salio. */
    const historial = readFileSync(join(t.raiz, 'data', 'historial-roadmap', 'proyecto.ndjson'), 'utf8');
    assert.match(historial, /"campo":"reabrir".*"sitio":"Agente\/completados\/tareas-2026-10-19\.md:3"/);
  });

  void it('una tarea que ya esta pendiente y sigue en completados se limpia sin tocar el roadmap', () => {
    const t = taller();
    /* Estado de dos fuentes enfrentadas: el roadmap la da por pendiente y el registro por cerrada
     * (p. ej. la linea volvio por una sincronizacion). Reabrir no tiene linea que escribir. */
    const carpeta = join(t.proyecto.ruta, 'Agente', 'completados');
    mkdirSync(carpeta, { recursive: true });
    const hoy = join(carpeta, 'tareas-2026-10-20.md');
    writeFileSync(hoy, '# Tareas completadas — 2026-10-20\n\n- **20AA-1 · Primera.** Cerrada desde el tab (TASK), 2026-10-20.\n', 'utf8');
    const antes = t.leer();
    const r = reabrirEnRoadmap(t.deps, t.proyecto, '20AA-1', 'Primera.', {});
    assert.equal(r.escribio, false);
    assert.equal(r.aviso, 'ya-esta-en-el-roadmap');
    assert.equal(t.leer(), antes);
    assert.equal(readFileSync(hoy, 'utf8'), '# Tareas completadas — 2026-10-20\n\n');
  });

  void it('reordenar cambia los bloques de sitio y lo anota con la posicion de cada uno', () => {
    const t = taller();
    const r = reordenarRoadmap(t.deps, t.proyecto, ['20AA-2', '20AA-1']);
    assert.equal(r.escribio, true);
    assert.deepEqual(t.leer().split('\n').slice(0, 9), [
      '## Pendientes',
      '',
      '- [ ] `20AA-2` — **Segunda.**',
      '',
      '- [ ] `20AA-1` — **Primera.**',
      '  · prioridad: alta',
      '  - [ ] **Su subtarea.**',
      '',
      '## Bloqueos',
    ]);
    assert.deepEqual(
      r.cambios.map((c) => `${c.id} ${c.antes}->${c.despues}`),
      ['20AA-2 2->1', '20AA-1 1->2'],
    );
  });

  void it('reordenar con el orden que ya habia no escribe el archivo', () => {
    const t = taller();
    const r = reordenarRoadmap(t.deps, t.proyecto, ['20AA-1', '20AA-2']);
    assert.equal(r.escribio, false);
    assert.equal(r.aviso, 'orden-sin-cambios');
    assert.equal(t.leer(), CUERPO);
  });
});
