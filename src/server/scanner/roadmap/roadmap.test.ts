/* Analisis del roadmap con la forma del protocolo (D8 de AGENTS-detalle.md).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/server/scanner/roadmap/roadmap.test.ts
 * [por que] El tablero solo ve trabajo abierto si las tareas tienen la forma canonica; cada
 * variante real que se encontro en el area (negrita, tabla, heading, casilla sin ID) tiene su
 * caso, con su control negativo. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../../plataforma/sistema/temporales.js';
import { TOPE_LINEAS_ROADMAP, TOPE_TAREAS, analizarRoadmap, resumenRoadmap } from './roadmap.js';

const motivos = (texto: string): string[] => analizarRoadmap(texto).problemas.map((p) => p.motivo);

describe('roadmap: tarea canonica', () => {
  it('lee ID y titulo de la linea del protocolo', () => {
    const a = analizarRoadmap('# Roadmap — x\n\n## Pendientes\n\n- [ ] `19AA-4` — **Coherencia del mapa.** Cuerpo.\n');
    assert.deepEqual(a.tareas, [
      { id: '19AA-4', titulo: 'Coherencia del mapa.', linea: 5, propiedades: {}, subtareas: [] },
    ]);
    assert.deepEqual(a.problemas, []);
  });

  it('el titulo es el nombre en negrita, no la linea entera', () => {
    /* [por que] Lo que va detras del nombre es el cuerpo en prosa de la tarea, y no es su titulo:
     * leer la linea entera mandaba a TASK un texto cortado a media frase (medido 2026-10-20: 195
     * de las 209 tareas del area tienen cola). */
    const a = analizarRoadmap(
      '## Pendientes\n\n- [ ] `19AA-4` — **Coherencia del mapa.** Instalación y preflight hechos;\n  el resto sigue abajo.\n',
    );
    assert.equal(a.tareas[0]?.titulo, 'Coherencia del mapa.');
    assert.deepEqual(a.problemas, []);
  });

  it('sin negrita no hay nombre que reconocer y el titulo es la linea', () => {
    const a = analizarRoadmap('## Pendientes\n\n- [ ] `19AA-4` — Coherencia del mapa, sin negrita.\n');
    assert.equal(a.tareas[0]?.titulo, 'Coherencia del mapa, sin negrita.');
  });

  it('un nombre sin cerrar no se recorta a la ligera', () => {
    /* Sin `**` de cierre no hay nombre: la linea entera es el titulo, como antes. */
    const a = analizarRoadmap('## Pendientes\n\n- [ ] `19AA-4` — **Coherencia a medias.\n');
    assert.equal(a.tareas[0]?.titulo, '**Coherencia a medias.');
  });

  it('la casilla sin ID es un problema de formato', () => {
    assert.deepEqual(motivos('## Pendientes\n\n- [ ] **Pin de Sentinel (aparcado).**\n'), [
      'casilla sin ID en la forma del protocolo',
    ]);
  });

  it('la casilla marcada es un problema: las completadas no viven en el roadmap', () => {
    assert.deepEqual(motivos('## Pendientes\n\n- [x] `T2` — **Algo.**\n'), [
      'tarea completada dentro del roadmap (va a Agente/completados/)',
    ]);
  });

  it('el bullet con ID en negrita (forma vieja) es un problema', () => {
    assert.deepEqual(motivos('## Pendientes\n\n- **18AA-7 — Algo.** Cuerpo.\n'), ['tarea sin casilla']);
    assert.deepEqual(motivos('## Pendientes\n\n1. **T3 — Numerada.**\n'), ['tarea sin casilla']);
  });

  it('el heading con ID y la fila de tabla son problemas', () => {
    assert.deepEqual(motivos('## Pendientes\n\n### T5 Arquitectura (medio).\n'), ['tarea escrita como heading']);
    assert.deepEqual(motivos('## Pendientes\n\n| ID | Tarea |\n| --- | --- |\n| `S17` | Ficha |\n'), ['tarea en tabla']);
  });
});

describe('roadmap: lo que no es una tarea', () => {
  /* [por que] El 2026-10-23 una tarea de un proyecto vivia en «Bloqueos» con forma de tarea
   * sin casilla y el tablero no la veia: el trabajo existia y nada lo decia. Prosa con un ID
   * dentro de una frase sigue sin ser tarea (control negativo de abajo). */
  it('fuera de una zona de tareas, un bullet con ID es una tarea mal colocada', () => {
    const texto = '# Roadmap — x\n\n## Bloqueos\n\n- `16A-5` — **CERRADO (2026-10-17):** otra cosa.\n';
    assert.deepEqual(motivos(texto), ['tarea con ID fuera de las secciones de tareas']);
  });

  it('una tarea con casilla fuera de sitio se cuenta y se avisa', () => {
    const texto = '# Roadmap — x\n\n## Bloqueos\n\n- [ ] `16A-5` — **Algo.**\n';
    const a = analizarRoadmap(texto);
    assert.deepEqual(a.tareas.map((t) => t.id), ['16A-5']);
    assert.deepEqual(a.problemas.map((p) => p.motivo), ['tarea en una sección que no es de trabajo abierto']);
  });

  it('prosa con IDs dentro de una frase no es una tarea', () => {
    const texto = '# Roadmap — x\n\n## Bloqueos\n\nDecidido: `13AA-2` queda para su ventana.\n';
    assert.deepEqual(analizarRoadmap(texto).problemas, []);
  });

  it('una mencion en prosa dentro de una tarea no crea otra tarea', () => {
    const texto = '## Pendientes\n\n- [ ] `19AA-1` — **Otra.** Depende de `19AA-9`.\n';
    assert.deepEqual(analizarRoadmap(texto).tareas.map((t) => t.id), ['19AA-1']);
  });

  it('las casillas sangradas son sub-pasos y los bloques de codigo se ignoran', () => {
    const texto = [
      '## Pendientes',
      '',
      '- [ ] `T5` — **Con sub-pasos.**',
      '  - [ ] apiEndpointAnalyzer.ts',
      '  - [x] otra cosa',
      '',
      '```text',
      '- [ ] `NO-1` ejemplo dentro de un bloque',
      '```',
      '',
    ].join('\n');
    const a = analizarRoadmap(texto);
    assert.deepEqual(a.tareas.map((t) => t.id), ['T5']);
    assert.deepEqual(a.problemas, []);
  });
});

/* [por que 20AA-10] El tab y el roadmap son la misma lista: el tab escribe las propiedades de la
 * tarea y sus subtareas en el archivo. Tolerante con lo que falta (es el valor por defecto) y
 * estricto con lo que esta escrito, para que una propiedad no se pierda en silencio. */
describe('roadmap: propiedades de la tarea', () => {
  const conProps = (lineas: string[]): string =>
    ['# Roadmap — x', '', '## Pendientes', '', '- [ ] `19AA-1` — **Una.**', ...lineas, ''].join('\n');

  it('lee la linea «·» pegada a la tarea', () => {
    const a = analizarRoadmap(
      conProps(['  · prioridad: alta · urgencia: urgente · creada: 2026-10-20 · depende-de: 20AA-8']),
    );
    assert.deepEqual(a.tareas[0].propiedades, {
      prioridad: 'alta',
      urgencia: 'urgente',
      creada: '2026-10-20',
      dependeDe: ['20AA-8'],
    });
    assert.deepEqual(a.problemas, []);
  });

  it('las etiquetas son una lista por comas', () => {
    const a = analizarRoadmap(conProps(['  · etiquetas: tareas, roadmap']));
    assert.deepEqual(a.tareas[0].propiedades.etiquetas, ['tareas', 'roadmap']);
  });

  it('sin linea de propiedades no hay problema: son los valores por defecto', () => {
    const a = analizarRoadmap(conProps(['  Cuerpo en prosa, sin propiedades.']));
    assert.deepEqual(a.tareas[0].propiedades, {});
    assert.deepEqual(a.problemas, []);
  });

  it('la clave desconocida es un problema, no un dato que se tira', () => {
    assert.deepEqual(motivos(conProps(['  · importancia: mucha'])), ['propiedad desconocida']);
  });

  it('el valor fuera del conjunto es un problema', () => {
    assert.deepEqual(motivos(conProps(['  · prioridad: altísima'])), ['valor fuera del conjunto']);
    assert.deepEqual(motivos(conProps(['  · urgencia: ya'])), ['valor fuera del conjunto']);
  });

  it('la fecha con otra forma es un problema', () => {
    assert.deepEqual(motivos(conProps(['  · creada: 20/10/2026'])), ['fecha con forma inválida']);
  });

  it('el par a medias es un problema', () => {
    assert.deepEqual(motivos(conProps(['  · prioridad:'])), ['par de propiedades a medias']);
    assert.deepEqual(motivos(conProps(['  · alta'])), ['par de propiedades a medias']);
  });

  it('la linea «·» despues del cuerpo esta fuera de sitio', () => {
    assert.deepEqual(motivos(conProps(['  Cuerpo.', '  · prioridad: alta'])), [
      'línea de propiedades fuera de sitio',
    ]);
  });

  it('la linea «·» sin tarea padre esta fuera de sitio', () => {
    assert.deepEqual(motivos('## Pendientes\n\n· prioridad: alta\n'), ['línea de propiedades fuera de sitio']);
  });

  it('dentro de un bloque de codigo no cuenta', () => {
    const texto = conProps(['```text', '  · prioridad: alta', '```']);
    assert.deepEqual(analizarRoadmap(texto).problemas, []);
  });
});

describe('roadmap: subtareas', () => {
  it('lee las subtareas sangradas con su estado y sus propiedades', () => {
    const texto = [
      '## Pendientes',
      '',
      '- [ ] `19AA-1` — **Con subtareas.**',
      '  · prioridad: alta',
      '  - [ ] **Leer el parser.**',
      '    · urgencia: urgente',
      '  - [x] **Escribir los tests.**',
      '',
    ].join('\n');
    const a = analizarRoadmap(texto);
    assert.deepEqual(a.tareas[0].subtareas, [
      { titulo: 'Leer el parser.', completada: false, linea: 5, propiedades: { urgencia: 'urgente' } },
      { titulo: 'Escribir los tests.', completada: true, linea: 7, propiedades: {} },
    ]);
    assert.deepEqual(a.tareas[0].propiedades, { prioridad: 'alta' });
    assert.deepEqual(a.problemas, []);
  });

  it('una subtarea sin tarea padre es un problema', () => {
    assert.deepEqual(motivos('## Pendientes\n\n  - [ ] **Suelta.**\n'), ['subtarea sin tarea padre']);
  });

  it('las propiedades de la subtarea no son las de la tarea', () => {
    const texto = ['## Pendientes', '', '- [ ] `T1` — **Una.**', '  - [ ] **Sub.**', '    · prioridad: baja', ''].join('\n');
    const a = analizarRoadmap(texto);
    assert.deepEqual(a.tareas[0].propiedades, {});
    assert.deepEqual(a.tareas[0].subtareas[0].propiedades, { prioridad: 'baja' });
  });
});

describe('roadmap: IDs', () => {
  it('el ID repetido en el mismo roadmap es un problema', () => {
    const texto = '## Pendientes\n\n- [ ] `T1` — **Una.**\n- [ ] `T1` — **Otra.**\n';
    const a = analizarRoadmap(texto);
    assert.deepEqual(a.problemas.map((p) => p.motivo), ['ID repetido en el roadmap']);
    assert.equal(a.problemas[0].linea, 4);
  });

  it('el mismo ID en dos proyectos distintos no es nada (la clave es proyecto + ID)', () => {
    assert.deepEqual(analizarRoadmap('## Pendientes\n\n- [ ] `T1` — **Una.**\n').problemas, []);
  });

  it('el tope de tareas del tablero son 60, y no recorta en silencio', () => {
    assert.equal(TOPE_TAREAS, 60);
  });

  /* [por que] D8 permite que un proyecto tenga esquema propio de IDs (OP-49c en opencode-propio,
   * A3b-verif en varsense). RE_ID no valida el ID de una tarea, pero sí decide si una línea mal
   * escrita «tiene un ID»: con el patrón viejo, la tarea mal escrita de un proyecto con esquema
   * propio pasaba desapercibida. Medido el 2026-10-20: 42 IDs reales del área se le escapaban. */
  it('reconoce los esquemas propios al detectar una tarea mal escrita', () => {
    const a = analizarRoadmap('## Pendientes\n\n- `OP-49c` — **Algo.**\n- `A3b-verif` — **Otra.**\n');
    assert.deepEqual(a.problemas.map((p) => p.motivo), ['tarea sin casilla', 'tarea sin casilla']);
  });

  /* [por que] Un `1` suelto es indistinguible de cualquier cifra en prosa: admitirlo convertiría en
   * «tarea en tabla» o «tarea sin casilla» media docena de líneas legítimas. Queda fuera a
   * propósito; los 9 IDs así de proyecto-h se arreglan en su roadmap, no aquí. */
  it('una cifra suelta no basta para parecer una tarea', () => {
    assert.deepEqual(analizarRoadmap('## Pendientes\n\n- `1` — **Algo.**\n').problemas, []);
    assert.deepEqual(analizarRoadmap('## Pendientes\n\n| 1 | Otra |\n').problemas, []);
  });
});

describe('roadmap: secciones', () => {
  it('reconoce las canonicas con adornos y singular', () => {
    const texto = [
      '## Contexto',
      '## Siguiente bloque',
      '## 🔴 Pendiente crítico',
      '## Pendientes (orden de dependencia)',
      '## Tareas pendientes (orden de dependencia)',
      '## Bloqueos y decisiones',
      '## Planes activos',
    ].join('\n');
    const a = analizarRoadmap(texto);
    assert.deepEqual(a.faltantes, []);
    assert.deepEqual(a.noCanonicas, []);
  });

  it('nombra lo que falta y lo que sobra', () => {
    const a = analizarRoadmap('# Roadmap — x\n\n## Hecho\n\n- algo\n');
    assert.deepEqual(a.faltantes, ['Siguiente bloque', 'Pendientes', 'Bloqueos', 'Planes activos']);
    assert.deepEqual(a.noCanonicas, ['Hecho']);
  });

  it('lee los planes declarados activos', () => {
    const texto =
      '## Planes activos\n\n- `Agente/planes/plan-x-2026-10-19.md` — `19AA-5`.\n- `Agente/planes/plan-y-2026-10-17.md` — `17AA-2`.\n';
    assert.deepEqual(analizarRoadmap(texto).planes, ['plan-x-2026-10-19.md', 'plan-y-2026-10-17.md']);
  });
});

describe('roadmap: resumenRoadmap', () => {
  let raiz: string;

  before(() => {
    mkdirSync(raizTemporales(), { recursive: true });
    raiz = mkdtempSync(join(raizTemporales(), 'roadmap-test-'));
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('sin roadmap.md devuelve el resumen vacio', () => {
    const p = mkdtempSync(join(raiz, 'sin-roadmap-'));
    assert.deepEqual(resumenRoadmap(p), {
      pendientes: 0,
      activos: 0,
      ids: [],
      tareas: [],
      resumen: '',
      lineas: 0,
      problemas: 0,
      faltantes: [],
      planes: [],
    });
  });

  it('cuenta pendientes, planes, lineas y problemas de formato', () => {
    const p = mkdtempSync(join(raiz, 'con-roadmap-'));
    /* [por que] Los planes activos salen del disco: el plan declarado tiene que existir, o el
     * resumen diria 0 aunque el roadmap lo liste. */
    mkdirSync(join(p, 'Agente', 'planes'), { recursive: true });
    writeFileSync(join(p, 'Agente', 'planes', 'plan-x-2026-10-19.md'), '1. **F1** hecho\n');
    writeFileSync(
      join(p, 'roadmap.md'),
      [
        '# Roadmap — x',
        '',
        '## Pendientes',
        '',
        '- [ ] `19AA-1` — **Una.**',
        '- [ ] `19AA-2` — **Otra.**',
        '- [ ] sin ID',
        '',
        '## Bloqueos',
        '## Planes activos',
        '',
        '- `Agente/planes/plan-x-2026-10-19.md` — `19AA-1`.',
        '',
      ].join('\n'),
    );
    const r = resumenRoadmap(p);
    assert.equal(r.pendientes, 2);
    assert.equal(r.activos, 1);
    assert.equal(r.problemas, 1);
    assert.deepEqual(r.planes, ['plan-x-2026-10-19.md']);
    assert.deepEqual(r.faltantes, ['Siguiente bloque']);
    assert.match(r.resumen, /Una/);
    assert.ok(r.lineas > 0);
    /* ID y titulo viajan al tablero: la consola los lista como problema 'pendiente'. */
    assert.deepEqual(r.tareas, [
      { id: '19AA-1', titulo: 'Una.' },
      { id: '19AA-2', titulo: 'Otra.' },
    ]);
  });

  it('el tope del protocolo son 400 lineas', () => {
    assert.equal(TOPE_LINEAS_ROADMAP, 400);
  });
});
