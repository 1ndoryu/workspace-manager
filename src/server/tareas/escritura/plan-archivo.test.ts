/* Escritura roadmap <- TASK (20AA-10 F3).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/tareas/escritura/plan-archivo.test.ts
 * [por que] Aqui vive lo que decide quien manda cuando los dos lados cambiaron: la tabla del plan,
 * la ventana de calma y el conflicto cuando no se puede saber. Un fallo aqui no rompe nada visible:
 * pierde una edicion en silencio, que es justo lo que no puede pasar. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analizarRoadmap, type TareaRoadmap } from '../../scanner/roadmap/roadmap.js';
import { contenidoDe, huellaDeTarea, textoDeTitulo, type EspejoContenido } from './contenido-tarea.js';
import { aplicarPlan, lineaPropiedades, planArchivo, type DepsPlanArchivo, type TareaAescribir } from './plan-archivo.js';
import type { ItemVersionado } from '../nucleo/tipos.js';

const T = Date.parse('2026-10-20T12:00:00.000Z');

const tarea = (texto: string, i = 0): TareaRoadmap => analizarRoadmap(texto).tareas[i];

const espejo = (p: Partial<EspejoContenido> = {}): EspejoContenido => ({
  texto: 'Una tarea.',
  prioridad: null,
  urgencia: null,
  etiquetas: [],
  dependeDe: [],
  fechas: {},
  ...p,
});

/* Item de TASK con su espejo guardado. `guardado` es lo que el puente sabe del lado del archivo
 * cuando escribio por ultima vez; `campos` es lo que TASK tiene ahora. */
function item(guardado: Record<string, unknown>, campos: Record<string, unknown> = {}): ItemVersionado {
  const updatedAt = (campos.updatedAt as string) ?? '2026-10-20T11:00:00.000Z';
  const { updatedAt: _, ...resto } = campos;
  return { id: (campos.id as number) ?? 900, item: { id: 900, parentId: null, orden: 0, ...resto, roadmap: guardado }, updatedAt };
}

function deps(parcial: Partial<DepsPlanArchivo> = {}): DepsPlanArchivo {
  return { tareas: [tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n')], enTask: [], mtimeArchivoMs: T, ahoraMs: T + 60_000, ...parcial };
}

/* El espejo tal como lo dejaria F2 con el archivo que se le pasa. */
const espejoDe = (t: TareaRoadmap): Record<string, unknown> => ({
  id: t.id,
  huella: huellaDeTarea(t),
  escritoEn: new Date(T - 60_000).toISOString(),
  espejo: contenidoDe(t.propiedades, textoDeTitulo(t.titulo)),
});

describe('planArchivo: la tabla del plan', () => {
  it('los dos iguales: nada que hacer', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n');
    const p = planArchivo(deps({ tareas: [t], enTask: [item(espejoDe(t), { texto: 'Una tarea.' })] }));
    assert.equal(p.alDia, 1);
    assert.equal(p.escribir, false);
    assert.deepEqual(p.tareas, []);
  });

  it('cambio el archivo y no TASK: lo escribe F2, aqui no se toca', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n  · prioridad: alta\n');
    const enTask = [item({ id: '20AA-1', huella: 'vieja', espejo: espejo() }, { texto: 'Una tarea.' })];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.losEscribeTask, 1);
    assert.equal(p.escribir, false);
  });

  it('cambio TASK y no el archivo: se escribe el archivo, con el diff por campo', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n');
    const enTask = [item(espejoDe(t), { texto: 'Una tarea.', prioridad: 'alta' })];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.escribir, true);
    assert.deepEqual(p.cambios, [{ id: '20AA-1', campo: 'prioridad', antes: null, despues: 'alta' }]);
    assert.equal(p.tareas[0].objetivo.prioridad, 'alta');
  });

  it('los dos cambiaron y llegaron al mismo sitio: al dia', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n  · prioridad: alta\n');
    const enTask = [item({ id: '20AA-1', huella: 'vieja', espejo: espejo() }, { texto: 'Una tarea.', prioridad: 'alta' })];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.alDia, 1);
    assert.equal(p.escribir, false);
  });

  it('los dos cambiaron distinto y el archivo es mas nuevo: manda el archivo', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n  · prioridad: alta\n');
    const enTask = [
      item(
        { id: '20AA-1', huella: 'vieja', escritoEn: new Date(T - 60_000).toISOString(), espejo: espejo() },
        { texto: 'Una tarea.', prioridad: 'baja', updatedAt: new Date(T - 10_000).toISOString() },
      ),
    ];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.losEscribeTask, 1);
    assert.equal(p.escribir, false);
  });

  it('los dos cambiaron distinto y TASK es mas nuevo: manda TASK', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n  · prioridad: alta\n');
    const enTask = [
      item(
        { id: '20AA-1', huella: 'vieja', escritoEn: new Date(T - 60_000).toISOString(), espejo: espejo() },
        { texto: 'Una tarea.', prioridad: 'baja', updatedAt: new Date(T + 10_000).toISOString() },
      ),
    ];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.escribir, true);
    assert.deepEqual(p.cambios, [{ id: '20AA-1', campo: 'prioridad', antes: 'alta', despues: 'baja' }]);
  });

  it('no se sabe quien cambio despues: conflicto, y no se escribe nada', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n  · prioridad: alta\n');
    /* El archivo es mas viejo que lo ultimo que escribio el puente: no puede ser el ganador. */
    const enTask = [
      item(
        { id: '20AA-1', huella: 'vieja', escritoEn: new Date(T + 5_000).toISOString(), espejo: espejo() },
        { texto: 'Una tarea.', prioridad: 'baja' },
      ),
    ];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.conflictos.length, 1);
    assert.equal(p.escribir, false);
    assert.deepEqual(p.tareas, []);
  });

  it('las marcas de tiempo casi iguales tampoco deciden', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n  · prioridad: alta\n');
    const enTask = [
      item(
        { id: '20AA-1', huella: 'vieja', escritoEn: new Date(T - 60_000).toISOString(), espejo: espejo() },
        { texto: 'Una tarea.', prioridad: 'baja', updatedAt: new Date(T - 500).toISOString() },
      ),
    ];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.conflictos.length, 1);
    assert.equal(p.conflictos[0].archivoMs, T);
  });

  it('el roadmap tocado hace un momento se deja para la pasada siguiente', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n');
    const enTask = [item(espejoDe(t), { texto: 'Una tarea.', prioridad: 'alta' })];
    const p = planArchivo(deps({ tareas: [t], enTask, mtimeArchivoMs: T + 59_500 }));
    assert.equal(p.enCalma, true);
    assert.equal(p.escribir, false);
    /* Se cuenta igual: el informe dice lo que hay, aunque esta pasada no lo escriba. */
    assert.equal(p.cambios.length, 1);
  });

  it('una tarea con espejo de una version vieja del puente no se toca', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n');
    const enTask = [item({ id: '20AA-1', huella: 'vieja' }, { texto: 'Una tarea.' })];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.sinEspejo, 1);
    assert.equal(p.escribir, false);
  });

  it('una tarea de TASK que no viene del roadmap no cuenta', () => {
    const p = planArchivo(deps({ enTask: [item({}, { texto: 'Mia, del escritorio' })] }));
    assert.equal(p.alDia, 0);
    assert.equal(p.sinEspejo, 0);
  });

  it('una subtarea de TASK no se confunde con una tarea del archivo', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n');
    const enTask = [item(espejoDe(t), { texto: 'Una tarea.', parentId: 42, id: 901 })];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.escribir, false);
    assert.equal(p.alDia, 0);
  });
});

describe('planArchivo: el valor por defecto de TASK no es un cambio', () => {
  /* TASK guarda `urgencia: normal` cuando nadie la manda (su `String` con `#[serde(default)]`).
   * Si eso contara como valor dicho, F3 escribiria `urgencia: normal` en las 198 lineas del area
   * en la primera pasada: lo ausente y el valor por defecto son lo mismo. */
  it('la urgencia normal de TASK frente al archivo que no la dice: nada que hacer', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n');
    const enTask = [item(espejoDe(t), { texto: 'Una tarea.', urgencia: 'normal' })];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.escribir, false);
    assert.equal(p.alDia, 1);
  });

  it('la urgencia que si se edito en TASK si se escribe', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n');
    const enTask = [item(espejoDe(t), { texto: 'Una tarea.', urgencia: 'urgente' })];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.deepEqual(p.cambios, [{ id: '20AA-1', campo: 'urgencia', antes: null, despues: 'urgente' }]);
    assert.equal(lineaPropiedades(p.tareas[0].objetivo), '  · urgencia: urgente');
  });

  it('el archivo que dice «normal» y TASK que tiene normal: al dia, la linea se queda', () => {
    const t = tarea('## Pendientes\n\n- [ ] `20AA-1` — **Una tarea.**\n  · urgencia: normal\n');
    const enTask = [item(espejoDe(t), { texto: 'Una tarea.', urgencia: 'normal' })];
    const p = planArchivo(deps({ tareas: [t], enTask }));
    assert.equal(p.alDia, 1);
    assert.equal(p.escribir, false);
  });
});

describe('planArchivo: la linea de propiedades', () => {
  it('en el orden del protocolo, no en el de llegada', () => {
    const linea = lineaPropiedades(
      espejo({ prioridad: 'alta', urgencia: 'urgente', etiquetas: ['a', 'b'], dependeDe: ['20AA-8'], fechas: { creada: '2026-10-01' } }),
    );
    assert.equal(linea, '  · prioridad: alta · urgencia: urgente · creada: 2026-10-01 · etiquetas: a, b · depende-de: 20AA-8');
  });

  it('sin nada que decir no hay linea', () => {
    assert.equal(lineaPropiedades(espejo()), null);
  });

  it('la sangria es la que el parser reconoce como de tarea', () => {
    const t = tarea(`## Pendientes\n\n- [ ] \`20AA-1\` — **Una.**\n${lineaPropiedades(espejo({ prioridad: 'alta' }))}\n`);
    assert.equal(t.propiedades.prioridad, 'alta');
    assert.deepEqual(analizarRoadmap(`## Pendientes\n\n- [ ] \`20AA-1\` — **Una.**\n${lineaPropiedades(espejo({ prioridad: 'alta' }))}\n`).problemas, []);
  });
});

describe('aplicarPlan: el texto del roadmap', () => {
  const conTarea = (lineas: string[]): TareaRoadmap => tarea(lineas.join('\n'));

  const aescribir = (t: TareaRoadmap, texto: string, props: Partial<EspejoContenido> = {}): TareaAescribir => ({
    t,
    objetivo: espejo({ texto, ...props }),
    cambios: [],
  });

  it('pone la linea «·» bajo la tarea cuando no estaba', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Una.**', ''];
    const t = conTarea(lineas);
    const salida = aplicarPlan(lineas, [aescribir(t, 'Una.', { prioridad: 'alta' })]);
    assert.equal(salida[2], '- [ ] `20AA-1` — **Una.**');
    assert.equal(salida[3], '  · prioridad: alta');
    assert.equal(salida[4], '');
  });

  it('la reescribe cuando ya estaba', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Una.**', '  · prioridad: baja', ''];
    const t = conTarea(lineas);
    const salida = aplicarPlan(lineas, [aescribir(t, 'Una.', { prioridad: 'alta' })]);
    assert.equal(salida[3], '  · prioridad: alta');
    assert.equal(salida.length, lineas.length);
  });

  it('la quita cuando no hay nada que decir', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Una.**', '  · prioridad: baja', ''];
    const t = conTarea(lineas);
    assert.deepEqual(aplicarPlan(lineas, [aescribir(t, 'Una.')]), ['## Pendientes', '', '- [ ] `20AA-1` — **Una.**', '']);
  });

  it('va antes de las subtareas, que son de la tarea', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Padre.**', '  - [ ] **Primera.**', ''];
    const t = conTarea(lineas);
    const salida = aplicarPlan(lineas, [aescribir(t, 'Padre.', { prioridad: 'alta' })]);
    assert.equal(salida[3], '  · prioridad: alta');
    assert.equal(salida[4], '  - [ ] **Primera.**');
  });

  it('no toca la linea si el texto no cambio', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Una.** Cuerpo con `codigo`.', ''];
    const t = conTarea(lineas);
    const salida = aplicarPlan(lineas, [aescribir(t, 'Una. Cuerpo con `codigo`.', { urgencia: 'normal' })]);
    assert.equal(salida[2], lineas[2]);
  });

  it('reescribe el texto conservando separador, negrita y lo que va fuera de ella', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Una.** Y algo mas', ''];
    const t = conTarea(lineas);
    const salida = aplicarPlan(lineas, [aescribir(t, 'Otra cosa. Y algo mas')]);
    assert.equal(salida[2], '- [ ] `20AA-1` — **Otra cosa.** Y algo mas');
  });

  it('si el titulo no iba en negrita, se escribe como manda el protocolo', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` - Una.', ''];
    const t = conTarea(lineas);
    const salida = aplicarPlan(lineas, [aescribir(t, 'Otra.')]);
    assert.equal(salida[2], '- [ ] `20AA-1` - **Otra.**');
  });

  it('aplica de abajo arriba: los numeros de linea del analisis siguen valiendo', () => {
    const lineas = [
      '## Pendientes',
      '',
      '- [ ] `20AA-1` — **Una.**',
      '- [ ] `20AA-2` — **Otra.**',
      '',
    ];
    const analisis = analizarRoadmap(lineas.join('\n'));
    const salida = aplicarPlan(
      lineas,
      analisis.tareas.map((t) => aescribir(t, textoDeTitulo(t.titulo), { prioridad: 'alta' })),
    );
    assert.deepEqual(salida, [
      '## Pendientes',
      '',
      '- [ ] `20AA-1` — **Una.**',
      '  · prioridad: alta',
      '- [ ] `20AA-2` — **Otra.**',
      '  · prioridad: alta',
      '',
    ]);
  });

  it('lo que escribe se vuelve a leer igual, y repetirlo no cambia nada', () => {
    const lineas = ['## Pendientes', '', '- [ ] `20AA-1` — **Una.**', ''];
    const t = conTarea(lineas);
    const plan = [aescribir(t, 'Una.', { prioridad: 'alta', etiquetas: ['sync'], dependeDe: ['20AA-8'] })];
    const salida = aplicarPlan(lineas, plan);
    const vuelta = analizarRoadmap(salida.join('\n'));
    assert.deepEqual(vuelta.problemas, []);
    assert.deepEqual(vuelta.tareas[0].propiedades, { prioridad: 'alta', etiquetas: ['sync'], dependeDe: ['20AA-8'] });
    assert.equal(vuelta.tareas[0].linea, 3);
    /* La segunda pasada parte del analisis del texto ya escrito: mismo texto, nada que cambiar. */
    assert.deepEqual(aplicarPlan(salida, plan), salida);
  });
});
