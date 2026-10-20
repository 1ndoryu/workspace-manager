/* Plan del espejo roadmap -> TASK (20AA-10 F2).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/tareas/espejo-roadmap.test.ts
 * [por que] Aqui vive lo delicado de la sincronia: que una linea del roadmap tenga una sola tarea
 * en TASK (nunca dos), que repetir la pasada no escriba nada, y que lo que ya hubiera en TASK no
 * se pierda por el camino (el PUT de TASK reemplaza el payload entero). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analizarRoadmap, type TareaRoadmap } from '../scanner/roadmap/roadmap.js';
import { huellaDeTarea, textoDeTitulo } from './escritura/contenido-tarea.js';
import { planEspejo, type DepsPlanEspejo } from './espejo-roadmap.js';
import type { ItemVersionado } from './nucleo/tipos.js';

const tareas = (texto: string): TareaRoadmap[] => analizarRoadmap(texto).tareas;

/* Item de TASK tal como lo sirve GET /api/projects/:id/tasks: el payload guardado a raiz. */
const item = (campos: Record<string, unknown>): ItemVersionado => ({
  id: campos.id as number,
  item: campos,
  updatedAt: (campos.updatedAt as string) ?? '2026-10-20T10:00:00Z',
});

function deps(parcial: Partial<DepsPlanEspejo> = {}): DepsPlanEspejo {
  return {
    tareas: tareas('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n'),
    enTask: [],
    proyectoId: 7,
    wmClave: 'glory-pulse',
    archivo: 'roadmap.md',
    seccion: 'Pendientes',
    mtimeArchivo: '2026-10-20T09:00:00.000Z',
    ahoraMs: 1_700_000_000_000,
    escritura: '2026-10-20T12:00:00.000Z',
    ocupados: new Set<number>(),
    ...parcial,
  };
}

/* El payload que el plan manda, con el espejo dentro. */
const espejoDe = (p: ReturnType<typeof planEspejo>) => p.acciones[0].parche.payload as Record<string, unknown>;

describe('espejo: crear', () => {
  it('una tarea nueva por cada pendiente, con el ID del roadmap en el payload', () => {
    const p = planEspejo(deps());
    assert.equal(p.acciones.length, 1);
    assert.equal(p.acciones[0].tipo, 'crear');
    assert.equal(p.acciones[0].parche.texto, 'Una tarea.');
    assert.equal(p.acciones[0].parche.completado, false);
    assert.equal(p.acciones[0].parche.proyectoId, 7);
    assert.equal(p.acciones[0].parche.parentId, null);
    const espejo = espejoDe(p).roadmap as Record<string, unknown>;
    assert.equal(espejo.id, '20AA-1');
    assert.equal(espejo.proyecto, 'glory-pulse');
    assert.equal(espejo.mtimeArchivo, '2026-10-20T09:00:00.000Z');
  });

  it('quita los marcadores de negrita del titulo: en TASK el texto es texto', () => {
    assert.equal(textoDeTitulo('**Título.** Cuerpo con `código`.'), 'Título. Cuerpo con `código`.');
  });

  it('al crear no manda expectedUpdatedAt: la tarea no existia', () => {
    assert.equal(planEspejo(deps()).acciones[0].parche.expectedUpdatedAt, null);
  });

  it('no manda prioridad ni urgencia si el roadmap no las dice', () => {
    const parche = planEspejo(deps()).acciones[0].parche;
    assert.equal('prioridad' in parche, false);
    assert.equal('urgencia' in parche, false);
  });

  it('las dice el roadmap: viajan al parche', () => {
    const d = deps({
      tareas: tareas('## Pendientes\n\n- [ ] `20AA-1` — **Una.**\n  · prioridad: alta · urgencia: urgente\n'),
    });
    const parche = planEspejo(d).acciones[0].parche;
    assert.equal(parche.prioridad, 'alta');
    assert.equal(parche.urgencia, 'urgente');
  });

  it('el titulo vacio y el que pasa de 1000 no se espejan, y se dicen', () => {
    const largo = 'x'.repeat(1001);
    const d = deps({ tareas: tareas(`## Pendientes\n\n- [ ] \`T1\` — **${largo}**\n- [ ] \`T2\` — ****\n`) });
    const p = planEspejo(d);
    assert.equal(p.acciones.length, 0);
    assert.deepEqual(p.rechazadas.map((r) => r.motivo), [
      'texto-demasiado-largo (tope 1000 de TASK)',
      'titulo-vacio',
    ]);
  });
});

describe('espejo: no duplicar', () => {
  it('con la huella guardada no hay nada que escribir', () => {
    const t = tareas('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n')[0];
    const enTask = [
      item({
        id: 900,
        texto: 'Una tarea.',
        completado: false,
        proyectoId: 7,
        parentId: null,
        orden: 0,
        roadmap: { id: '20AA-1', proyecto: 'glory-pulse', huella: huellaDeTarea(t) },
      }),
    ];
    const p = planEspejo(deps({ enTask }));
    assert.deepEqual(p.acciones, []);
    assert.equal(p.alDia, 1);
  });

  it('el ID del roadmap es lo que empareja: una tarea de TASK sin espejo no se toca', () => {
    const enTask = [item({ id: 901, texto: 'Mia, del escritorio', completado: false, proyectoId: 7, parentId: null })];
    const p = planEspejo(deps({ enTask }));
    assert.equal(p.acciones.length, 1);
    assert.equal(p.acciones[0].tipo, 'crear');
    assert.equal(p.acciones[0].legacyId === 901, false);
  });

  it('si el roadmap cambio, actualiza la que ya existe y no crea otra', () => {
    const t = tareas('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n')[0];
    const enTask = [
      item({
        id: 900,
        texto: 'Una tarea.',
        proyectoId: 7,
        parentId: null,
        orden: 0,
        roadmap: { id: '20AA-1', proyecto: 'glory-pulse', huella: 'vieja' },
      }),
    ];
    const p = planEspejo(deps({ enTask }));
    assert.equal(p.acciones.length, 1);
    assert.equal(p.acciones[0].tipo, 'actualizar');
    assert.equal(p.acciones[0].legacyId, 900);
    assert.equal(p.acciones[0].parche.expectedUpdatedAt, '2026-10-20T10:00:00Z');
    assert.equal((espejoDe(p).roadmap as Record<string, unknown>).huella, huellaDeTarea(t));
  });

  it('el ID repetido en el roadmap no se espeja: las dos lineas pelearian por la misma tarea', () => {
    /* El parser ya lo marca como problema de formato; el plan no crea dos tareas con el mismo ID. */
    const d = deps({
      tareas: tareas('## Pendientes\n\n- [ ] `T1` — **Una.**\n- [ ] `T1` — **Otra.**\n'),
    });
    const p = planEspejo(d);
    assert.deepEqual(p.acciones, []);
    assert.deepEqual(p.rechazadas, [
      { id: 'T1', motivo: 'ID repetido en el roadmap' },
      { id: 'T1', motivo: 'ID repetido en el roadmap' },
    ]);
  });
});

describe('espejo: el payload de TASK no se pierde', () => {
  it('conserva las claves propias y no repite las reservadas', () => {
    const t = tareas('## Pendientes\n\n- [ ] `20AA-1` — **Una.**\n')[0];
    const enTask = [
      item({
        id: 900,
        texto: 'Una.',
        completado: false,
        prioridad: 'baja',
        urgencia: 'chill',
        proyectoId: 7,
        parentId: null,
        orden: 3,
        fechaCompletado: '2026-10-19',
        etiquetaMia: 'verde',
        roadmap: { id: '20AA-1', huella: 'vieja' },
      }),
    ];
    const payload = espejoDe(planEspejo(deps({ enTask }))) as Record<string, unknown>;
    assert.equal(payload.fechaCompletado, '2026-10-19');
    assert.equal(payload.etiquetaMia, 'verde');
    for (const k of ['id', 'texto', 'completado', 'prioridad', 'urgencia', 'proyectoId', 'parentId', 'orden']) {
      assert.equal(k in payload, false, `la clave reservada ${k} no debe viajar en el payload`);
    }
    assert.equal(typeof payload.roadmap, 'object');
  });

  it('si el roadmap no dice la prioridad, la que ya tenia TASK se respeta', () => {
    const t = tareas('## Pendientes\n\n- [ ] `20AA-1` — **Una.**\n')[0];
    const enTask = [
      item({ id: 900, texto: 'Una.', prioridad: 'muy_alta', urgencia: 'chill', parentId: null, roadmap: { id: '20AA-1', huella: 'vieja' } }),
    ];
    const parche = planEspejo(deps({ enTask })).acciones[0].parche;
    assert.equal(parche.prioridad, 'muy_alta');
    assert.equal(parche.urgencia, 'chill');
    assert.equal(huellaDeTarea(t).length, 16);
  });
});

describe('espejo: subtareas', () => {
  const conSubs = (): TareaRoadmap[] =>
    tareas(
      [
        '## Pendientes',
        '',
        '- [ ] `20AA-1` — **Padre.**',
        '  - [ ] **Primera.**',
        '  - [x] **Segunda.**',
        '',
      ].join('\n'),
    );

  it('van despues del padre y con su parentId', () => {
    const p = planEspejo(deps({ tareas: conSubs() }));
    assert.deepEqual(p.acciones.map((a) => a.id), ['20AA-1', '20AA-1#1', '20AA-1#2']);
    const [padre, primera, segunda] = p.acciones;
    assert.equal(padre.parche.parentId, null);
    assert.equal(primera.parche.parentId, padre.legacyId);
    assert.equal(primera.parche.texto, 'Primera.');
    assert.equal(primera.parche.completado, false);
    assert.equal(segunda.parche.completado, true);
    assert.equal(segunda.parche.parentId, padre.legacyId);
  });

  it('cada subtarea tiene su propio ID legacy y su hueco', () => {
    const p = planEspejo(deps({ tareas: conSubs() }));
    const ids = p.acciones.map((a) => a.legacyId);
    assert.equal(new Set(ids).size, 3);
    const espejo = p.acciones[2].parche.payload?.roadmap as Record<string, unknown>;
    assert.equal(espejo.sub, true);
    assert.equal(espejo.padre, '20AA-1');
    assert.equal(espejo.hueco, 1);
  });

  it('la subtarea que ya existe por texto no se vuelve a crear', () => {
    const padre = item({ id: 900, texto: 'Padre.', parentId: null, roadmap: { id: '20AA-1', huella: 'vieja' } });
    const hija = item({
      id: 905,
      texto: 'Primera.',
      parentId: 900,
      roadmap: { id: '20AA-1', sub: true, padre: '20AA-1', huella: 'vieja' },
    });
    const p = planEspejo(deps({ tareas: conSubs(), enTask: [padre, hija] }));
    const crear = p.acciones.filter((a) => a.tipo === 'crear').map((a) => a.id);
    assert.deepEqual(crear, ['20AA-1#2']);
    assert.equal(p.acciones.find((a) => a.id === '20AA-1#1')?.legacyId, 905);
  });

  it('si cambio el texto, empareja por posicion entre las hermanas que quedan', () => {
    const padre = item({ id: 900, texto: 'Padre.', parentId: null, roadmap: { id: '20AA-1', huella: 'vieja' } });
    const hija = item({ id: 905, texto: 'Primera, renombrada.', parentId: 900, roadmap: { sub: true, huella: 'vieja' } });
    const p = planEspejo(deps({ tareas: conSubs(), enTask: [padre, hija] }));
    const primera = p.acciones.find((a) => a.id === '20AA-1#1');
    assert.equal(primera?.tipo, 'actualizar');
    assert.equal(primera?.legacyId, 905);
    assert.equal(primera?.parche.texto, 'Primera.');
  });

  it('las subtareas no se confunden con tareas raiz de TASK', () => {
    const hijaSuelta = item({ id: 906, texto: 'Primera.', parentId: 42 });
    const p = planEspejo(deps({ tareas: conSubs(), enTask: [hijaSuelta] }));
    /* La hija de otro padre no vale como pareja: las tres se crean. */
    assert.deepEqual(p.acciones.map((a) => a.tipo), ['crear', 'crear', 'crear']);
  });
});
