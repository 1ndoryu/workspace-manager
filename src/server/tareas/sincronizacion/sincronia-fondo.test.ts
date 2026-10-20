/* Test de la sincronia de fondo (20AA-10 F6): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/tareas/sincronizacion/sincronia-fondo.test.ts`.
 * TASK es un doble en memoria (ni red ni disco): lo que se prueba es el CUANDO —una pasada por
 * rafaga, una a la vez, y que un fallo no tumbe a quien la disparo— no el espejo, que tiene su
 * propio test. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearSincroniaFondo, TOPE_ESCRITURAS } from './sincronia-fondo.js';
import { sincronizarTareasRoadmap, type ProyectoWm } from './sincronizar-tareas.js';
import type { PuenteTareas } from '../puente-tareas.js';
import type { ParcheTarea } from '../tarea-unitaria.js';
import type { ItemVersionado } from '../nucleo/tipos.js';
import type { TareaRoadmap } from '../../scanner/roadmap/roadmap.js';

const COLUMNA = 9;
const PROYECTO: ProyectoWm = { clave: 'demo', nombre: 'demo', ruta: 'C:/tmp/demo' };

/* TASK de mentira: guarda lo que se le escribe, que es lo que hace que la segunda pasada vea la
 * huella guardada y no vuelva a escribir (idempotencia, sin la cual el tope no convergeria). */
function fakeTask() {
  const tareas = new Map<number, ItemVersionado>();
  const escrituras: number[] = [];
  const puente = {
    listar: async () => [...tareas.values()],
    actualizar: async (legacyId: number, parche: ParcheTarea) => {
      escrituras.push(legacyId);
      const previo = tareas.get(legacyId)?.item ?? {};
      /* TASK aplana las claves del `payload` en el item (y lo reemplaza entero en cada PUT): el
       * espejo queda al mismo nivel que lo demas, que es donde lo busca `espejoDeItem`. Guardarlo
       * anidado haria que cada pasada no reconociera lo escrito y volviera a crearlo todo. */
      const { payload, ...resto } = parche;
      const item = { ...previo, ...resto, ...(payload ?? {}) } as Record<string, unknown>;
      const guardada: ItemVersionado = { id: legacyId, item, updatedAt: `t${escrituras.length}` };
      tareas.set(legacyId, guardada);
      return guardada;
    },
    proyectos: async () => [{ legacyId: COLUMNA, nombre: 'demo', estado: 'activo', orden: 0, wmClave: 'demo' }],
  } as unknown as PuenteTareas;
  return { puente, escrituras, tareas };
}

/* Roadmap de mentira: `n` tareas, la primera con dos subtareas. */
function roadmap(n: number): { tareas: TareaRoadmap[]; mtime: string | null } {
  const tareas: TareaRoadmap[] = [];
  for (let i = 1; i <= n; i += 1) {
    tareas.push({
      id: `X${i}`,
      titulo: `Tarea ${i}.`,
      linea: i,
      propiedades: {},
      subtareas:
        i === 1
          ? [
              { titulo: 'Hija A.', completada: false, linea: 2, propiedades: {} },
              { titulo: 'Hija B.', completada: false, linea: 3, propiedades: {} },
            ]
          : [],
    });
  }
  return { tareas, mtime: '2026-10-20T00:00:00.000Z' };
}

/* Espera a que se cumpla una condicion, con tope: los temporizadores de la sincronia son de
 * verdad (no se inyecta reloj) pero cortos, y esperar de mas solo hace lento el test. */
async function hasta(condicion: () => boolean, ms = 2000): Promise<void> {
  const fin = Date.now() + ms;
  while (!condicion() && Date.now() < fin) await new Promise((r) => setTimeout(r, 5));
  assert.ok(condicion(), 'la condicion no se cumplio a tiempo');
}

void describe('sincronia de fondo', () => {
  void it('una rafaga de peticiones es una sola pasada', async () => {
    const { puente, escrituras } = fakeTask();
    const sincronia = crearSincroniaFondo(
      { proyectos: () => [PROYECTO], puente, leerRoadmap: () => roadmap(3) },
      { calmaMs: 20 },
    );
    sincronia.programar();
    sincronia.programar();
    sincronia.programar();
    await hasta(() => sincronia.estado().pasadas === 1);
    /* Las tres tareas y las dos hijas de la primera, una vez cada una: ni una pasada por gesto ni
     * una escritura por pasada. */
    assert.equal(escrituras.length, 5);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(sincronia.estado().pasadas, 1, 'no se rearmo sin motivo');
    await sincronia.detener();
  });

  void it('no se solapa: lo que llega mientras corre se lanza al terminar', async () => {
    const { puente } = fakeTask();
    let corriendo = 0;
    let maximo = 0;
    const puenteLento = {
      ...puente,
      listar: async () => {
        corriendo += 1;
        maximo = Math.max(maximo, corriendo);
        await new Promise((r) => setTimeout(r, 20));
        corriendo -= 1;
        return [];
      },
    } as unknown as PuenteTareas;
    const sincronia = crearSincroniaFondo(
      { proyectos: () => [PROYECTO], puente: puenteLento, leerRoadmap: () => roadmap(1) },
      { calmaMs: 10 },
    );
    sincronia.programar();
    await hasta(() => sincronia.estado().enCurso);
    sincronia.programar();
    await hasta(() => sincronia.estado().pasadas === 2);
    assert.equal(maximo, 1, 'dos pasadas a la vez escribirian lo mismo dos veces');
    await sincronia.detener();
  });

  void it('un fallo entero se dice en el estado, no se propaga', async () => {
    const { puente } = fakeTask();
    const sincronia = crearSincroniaFondo(
      {
        proyectos: () => [PROYECTO],
        puente,
        leerRoadmap: () => {
          throw new Error('roadmap ilegible');
        },
      },
      { calmaMs: 10 },
    );
    sincronia.programar();
    await hasta(() => sincronia.estado().pasadas === 1);
    const e = sincronia.estado();
    assert.equal(e.ultimoError, 'roadmap ilegible');
    assert.equal(e.ultima, null);
    await sincronia.detener();
  });

  void it('lo que el tope aplaza lo sigue la pasada siguiente, sin esperar la calma', async () => {
    const { puente, escrituras } = fakeTask();
    /* Calma larga y aplazadas cortas: si el encadenado esperase la calma, tres pasadas tardarian
     * 900 ms y el tope de abajo lo cazaria. */
    const arranque = Date.now();
    const sincronia = crearSincroniaFondo(
      { proyectos: () => [PROYECTO], puente, leerRoadmap: () => roadmap(5) },
      { calmaMs: 300, calmaAplazadasMs: 10, topeEscrituras: 2 },
    );
    sincronia.programar();
    /* Tres pasadas (3+2+2: la primera se lleva la tarea con sus hijas) hasta no dejar nada. */
    await hasta(() => sincronia.estado().pasadas === 3);
    assert.ok(Date.now() - arranque < 600, 'las pasadas encadenadas no esperan la calma entera');
    assert.equal(escrituras.length, 7);
    assert.equal(sincronia.estado().ultima?.informe.aplazadas, 0);
    await sincronia.detener();
  });

  void it('el tope no corta entre un padre y sus subtareas', async () => {
    const { puente, tareas } = fakeTask();
    /* Tope 1: la primera escritura es la tarea X1 (raiz) y, con el corte ciego, sus dos hijas
     * quedarian para la pasada siguiente. TASK rechaza un hijo sin padre, asi que la pasada tiene
     * que terminar el grupo. */
    const informe = await sincronizarTareasRoadmap(
      { proyectos: () => [PROYECTO], puente, leerRoadmap: () => roadmap(2) },
      { topeEscrituras: 1 },
    );
    assert.equal(informe.crear, 3, 'el padre y sus dos hijas en la misma pasada');
    assert.equal(informe.aplazadas, 1, 'lo que sobra es la tarea suelta, no media familia');
    const padre = [...tareas.values()].find((t) => t.item.parentId === null || t.item.parentId === undefined);
    assert.ok(padre, 'la raiz se escribio');
    const hijos = [...tareas.values()].filter((t) => t.item.parentId === padre.id);
    assert.equal(hijos.length, 2);
  });

  void it('una pasada que no avanza no se rearma (no es un bucle)', async () => {
    const { puente } = fakeTask();
    /* TASK rechaza todo: nada se escribe y todo queda aplazado. Rearmar aqui seria un bucle. */
    const puenteRoto = {
      ...puente,
      actualizar: async () => {
        throw new Error('sin sesion');
      },
    } as unknown as PuenteTareas;
    const sincronia = crearSincroniaFondo(
      { proyectos: () => [PROYECTO], puente: puenteRoto, leerRoadmap: () => roadmap(5) },
      { calmaMs: 10, topeEscrituras: 2 },
    );
    sincronia.programar();
    await hasta(() => sincronia.estado().pasadas === 1);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(sincronia.estado().pasadas, 1);
    assert.equal(sincronia.estado().ultima?.informe.detalle[0]?.errores.length, 7);
    await sincronia.detener();
  });

  void it('el tope por defecto deja la pasada en un tramo corto', async () => {
    const { puente, escrituras } = fakeTask();
    const sincronia = crearSincroniaFondo(
      { proyectos: () => [PROYECTO], puente, leerRoadmap: () => roadmap(TOPE_ESCRITURAS + 3) },
      { calmaMs: 10 },
    );
    sincronia.programar();
    await hasta(() => sincronia.estado().pasadas === 1);
    assert.equal(escrituras.length, TOPE_ESCRITURAS);
    await sincronia.detener();
  });
});
