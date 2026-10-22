/* Puras de la clasificacion de la consola (falsos positivos del tablero).
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/clasificacionConsola.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contarProblemas,
  huellaMotivo,
  marcarHuellas,
  problemasDe,
  categoriasDe,
  problemaHuerfanosSinProyecto,
  problemasDevDe,
  problemasSentinelDe,
  problemasVulnerabilidadDe,
  type Entrada,
} from './clasificacionConsola.js';
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from '../types.js';
import type { AvisoArtefacto, HuerfanoDev } from '../dev.js';
import type { InformeDev } from '../dev.js';

/* Proyecto minimo: solo los campos que lee la clasificacion. */
const proyecto = { id: 'demo', clave: 'demo' } as unknown as Proyecto;

const entrada = (over: Partial<Entrada>): Entrada => ({
  categoria: 'sentinel',
  motivo: 'x',
  seriedad: 'advertencia',
  ...over,
});

describe('contarProblemas', () => {
  it('cuenta todas las entradas mostradas, tengan o no seriedad', () => {
    const entradas = [entrada({}), entrada({ seriedad: null }), entrada({ seriedad: 'error' })];
    assert.equal(contarProblemas(entradas), 3);
  });

  it('devuelve 0 sin entradas', () => {
    assert.equal(contarProblemas([]), 0);
  });
});

describe('sentinel: severidad', () => {
  const analisis = (severidad: 'error' | 'warning' | 'information' | 'hint'): AnalisisSentinel =>
    ({
      clave: 'demo',
      estado: 'conHallazgos',
      analizadoEn: '2026-10-11T00:00:00.000Z',
      hallazgos: [{ severidad, ruleId: 'R1', mensaje: 'm', archivo: 'a.ts', linea: 1 }],
    }) as unknown as AnalisisSentinel;

  it('hint e information se muestran sin seriedad y cuentan', () => {
    for (const sev of ['hint', 'information'] as const) {
      const p = problemasSentinelDe(proyecto, analisis(sev));
      assert.ok(p);
      assert.equal(p.entradas[0].seriedad, null);
      assert.equal(contarProblemas(p.entradas), 1);
    }
  });

  it('warning cuenta como problema', () => {
    const p = problemasSentinelDe(proyecto, analisis('warning'));
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 1);
  });

  it('error cuenta como problema con seriedad error', () => {
    const p = problemasSentinelDe(proyecto, analisis('error'));
    assert.ok(p);
    assert.equal(p.entradas[0].seriedad, 'error');
    assert.equal(contarProblemas(p.entradas), 1);
  });
});

describe('vulnerabilidades: sin parche upstream', () => {
  const vuln = (paquete: string): AnalisisVulnerabilidades =>
    ({
      clave: 'demo',
      gestor: 'cargo',
      estado: 'conHallazgos',
      analizadoEn: '2026-10-11T00:00:00.000Z',
      hallazgos: [{ paquete, severidad: 'high', rango: '<1.0' }],
    }) as unknown as AnalisisVulnerabilidades;

  it('rsa (sin parche) se muestra sin seriedad y cuenta', () => {
    const p = problemasVulnerabilidadDe(proyecto, vuln('rsa'));
    assert.ok(p);
    assert.equal(p.entradas[0].seriedad, null);
    assert.equal(contarProblemas(p.entradas), 1);
  });

  it('un paquete con parche sigue contando', () => {
    const p = problemasVulnerabilidadDe(proyecto, vuln('react-router'));
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 1);
  });
});

describe('dev: bajo mando', () => {
  const informe = (estado: 'bajo-mando' | 'deriva'): InformeDev =>
    ({
      proyectos: [{ clave: 'demo', id: 'demo-dev', estado, motivo: 'm' }],
      huerfanos: [],
      errorSensor: null,
    }) as unknown as InformeDev;

  it('bajo mando no es problema: no aparece ni cuenta', () => {
    const p = problemasDevDe(proyecto, informe('bajo-mando'), null);
    assert.equal(p, null);
  });

  /* El interruptor del protocolo permanente vive en la consola: sin su linea no habria donde
   * encenderlo ni apagarlo desde el panel (el detalle solo opera al clicar la caja). */
  it('bajo mando con permanente lleva la casilla encendida', () => {
    const conBandera = {
      proyectos: [{ clave: 'demo', id: 'demo-dev', estado: 'bajo-mando', motivo: 'm', permanente: true }],
      huerfanos: [],
      errorSensor: null,
    } as unknown as InformeDev;
    const p = problemasDevDe(proyecto, conBandera, null);
    assert.ok(p);
    assert.equal(p.entradas[0].devId, 'demo-dev');
    assert.equal(p.entradas[0].devPermanente, true);
  });

  /* Al apagarla, la linea desaparece: la consola vuelve a ocultar el bajo-mando sano (2026-10-12),
   * y encenderla otra vez se hace desde la casilla del detalle del proyecto. */
  it('bajo mando sin permanente no deja linea ni casilla', () => {
    const p = problemasDevDe(proyecto, informe('bajo-mando'), null);
    assert.equal(p, null);
  });

  it('deriva sigue contando como problema', () => {
    const p = problemasDevDe(proyecto, informe('deriva'), null);
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 1);
  });
});

/* [por que] Un proceso elevado deja `exe` vacio (CIM no lo lee sin permisos) y el
 * motivo salia como «pid 12528 (pid 12528)»: el pid dos veces y ningun nombre. El
 * cmd es la unica fuente del nombre cuando el exe no llega. */
describe('huerfano: nombre del proceso', () => {
  const huerfano = (over: Partial<HuerfanoDev>): HuerfanoDev =>
    ({ ip: '127.0.0.1', puerto: 5432, pid: 12528, exe: null, cmd: '', verificado: false, clave: null, ...over }) as HuerfanoDev;

  it('sin exe, el nombre sale del cmd (proceso elevado)', () => {
    const p = problemaHuerfanosSinProyecto({ huerfanos: [huerfano({ cmd: '"C:\\Program Files\\PostgreSQL\\16\\bin\\postgres.exe" -D C:\\pgdata' })] } as unknown as InformeDev);
    assert.ok(p);
    assert.match(p.entradas[0].motivo, /sin proyecto: postgres\.exe \(pid 12528\) NO-VERIFICADO/);
  });

  it('sin exe ni cmd se dice desconocido, no el pid dos veces', () => {
    const p = problemaHuerfanosSinProyecto({ huerfanos: [huerfano({})] } as unknown as InformeDev);
    assert.ok(p);
    assert.match(p.entradas[0].motivo, /sin proyecto: proceso desconocido \(pid 12528\)/);
  });

  it('el exe manda sobre el cmd', () => {
    const p = problemaHuerfanosSinProyecto({ huerfanos: [huerfano({ exe: 'C:\\otro\\servicio.exe', cmd: 'algo.exe --x' })] } as unknown as InformeDev);
    assert.ok(p);
    assert.match(p.entradas[0].motivo, /sin proyecto: servicio\.exe/);
  });
});

/* [por que] La usuaria pidio (2026-10-20) que los pendientes del roadmap dejaran de ser un
 * contador aparte y fueran un tipo de problema mas: listables y filtrables en la consola. */
describe('pendiente: trabajo abierto del roadmap', () => {
  /* Fixture minimo: solo los campos que lee la clasificacion. `over` no comprueba los
   * tipos de los valores (los subobjetos van recortados a lo que se usa). */
  const repo = (over: Partial<Record<keyof Proyecto, unknown>> = {}): Proyecto =>
    ({
      id: 'demo',
      clave: 'demo',
      ruta: 'demo',
      esGit: true,
      tipo: 'repo',
      git: { dirty: false, cambios: { staged: 0, unstaged: 0, untracked: 0 }, worktreesOrfanos: [], remoto: 'origin', ahead: 0 },
      gate: { declarado: true, sentinel: 'config', varsense: true, doctor: null, gateDisponible: true, puerta: 'sentinel' },
      ...over,
    }) as unknown as Proyecto;

  const roadmap = (tareas: { id: string; titulo: string }[]): Proyecto['roadmap'] =>
    ({ pendientes: tareas.length, activos: 0, ids: [], tareas, resumen: '', lineas: 10, problemas: 0, faltantes: [], planes: [] });

  /* [por que el titulo va sin negrita] Lo que llega aqui es el `titulo` del snapshot, y el escaner
   * ya quito el marcado al leer la linea (el nombre de la tarea es la negrita que la abre): la
   * clasificacion no tiene que limpiar nada. */
  it('una entrada por tarea, con su ID y su titulo, y sin seriedad', () => {
    const p = problemasDe(repo({ roadmap: roadmap([{ id: 'X1', titulo: 'Uno.' }, { id: 'X2', titulo: 'Dos.' }]) }));
    assert.ok(p);
    assert.equal(contarProblemas(p.entradas), 2);
    assert.equal(p.entradas[0].categoria, 'pendiente');
    assert.equal(p.entradas[0].motivo, 'X1 — Uno.');
    assert.equal(p.entradas[0].seriedad, null);
    assert.deepEqual(categoriasDe(p), ['pendiente']);
  });

  it('va despues de los defectos del mismo proyecto', () => {
    const p = problemasDe(repo({ roadmap: roadmap([{ id: 'X1', titulo: 'Uno' }]) , git: { dirty: true, cambios: { staged: 1, unstaged: 0, untracked: 0 }, worktreesOrfanos: [], remoto: 'origin', ahead: 0 } }));
    assert.ok(p);
    assert.deepEqual(p.entradas.map((e) => e.categoria), ['sinCommit', 'pendiente']);
  });

  it('sin tareas no inventa entradas', () => {
    assert.equal(problemasDe(repo({ roadmap: roadmap([]) })), null);
    assert.equal(problemasDe(repo({})), null);
  });

  it('una carpeta sin git tambien declara sus pendientes', () => {
    const p = problemasDe(repo({ esGit: false, tipo: 'carpeta', roadmap: roadmap([{ id: 'X1', titulo: 'Uno' }]) }));
    assert.ok(p);
    assert.deepEqual(p.entradas.map((e) => e.categoria), ['sinGit', 'pendiente']);
  });
});

/* [por que 20AA-7] El aviso de artefactos llega por `InformeDev`, igual que los
 * huerfanos; se atribuye al proyecto CONSUMIDOR (el que tiene que recompilar o
 * copiar), no al que produce el artefacto. */
describe('artefacto: lo que esta entrada consume de otro proyecto', () => {
  const informe = (artefactos: InformeDev['artefactos']): InformeDev =>
    ({ proyectos: [], huerfanos: [], errorSensor: null, artefactos }) as unknown as InformeDev;

  const aviso = (proyecto: string, veredicto: AvisoArtefacto['veredicto']): AvisoArtefacto =>
    ({ proyecto, consumido: 'proyecto-web:frontend/dist', veredicto, detalle: 'producto 1 < consumido 2' });

  it('un artefacto desactualizado del propio proyecto es advertencia, no error', () => {
    const p = problemasDevDe(proyecto, informe([aviso('demo', 'desactualizado')]), null);
    assert.ok(p);
    assert.equal(p.entradas[0].categoria, 'dev');
    assert.equal(p.entradas[0].seriedad, 'advertencia');
    assert.match(p.entradas[0].motivo, /artefacto desactualizado: proyecto-web:frontend\/dist/);
  });

  it('el artefacto de otro proyecto no se le atribuye', () => {
    assert.equal(problemasDevDe(proyecto, informe([aviso('otro', 'desactualizado')]), null), null);
  });

  it('sin artefactos no cambia nada', () => {
    assert.equal(problemasDevDe(proyecto, informe([]), null), null);
  });
});

describe('huellaMotivo', () => {
  it('ignora numeros, tildes y mayusculas: es la identidad del problema', () => {
    assert.equal(
      huellaMotivo('PROYECTO TASKS: línea 163 — Usar selector del sistema'),
      huellaMotivo('proyecto tasks:  linea 27 — usar selector del sistema'),
    );
  });

  it('distingue dos problemas distintos del mismo archivo', () => {
    assert.notEqual(huellaMotivo('html nativo en vez de componente'), huellaMotivo('color a mano'));
  });
});

describe('marcarHuellas', () => {
  it('numera los empates dentro del grupo, en orden de aparición', () => {
    const grupos = marcarHuellas([
      { p: proyecto, entradas: [entrada({ motivo: 'línea 12 rota' }), entrada({ motivo: 'línea 99 rota' }), entrada({ motivo: 'otra cosa' })] },
    ]);
    const h = grupos[0].entradas.map((e) => e.huella);
    assert.equal(h[0], h[1]!.replace('~1', ''), 'la primera se queda con la base');
    assert.match(h[1]!, /~1$/);
    assert.match(h[2]!, /^sentinel\|otra cosa$/);
  });

  it('la misma entrada conserva su huella al reordenar el grupo', () => {
    const a = entrada({ motivo: 'problema A' });
    const b = entrada({ motivo: 'problema B' });
    const [ida] = marcarHuellas([{ p: proyecto, entradas: [a, b] }])[0].entradas;
    const [idb] = marcarHuellas([{ p: proyecto, entradas: [b, a] }])[0].entradas;
    assert.equal(a.huella, ida.huella);
    assert.equal(b.huella, idb.huella);
  });
});
