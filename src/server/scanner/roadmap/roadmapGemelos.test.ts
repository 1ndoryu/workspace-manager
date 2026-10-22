/* [17AA-5] Guarda del gemelo de reglas del roadmap.
 * El tablero (`roadmapAnalisis.ts`) y el cierre (`scripts/dev/proyecto/cierre.mjs`) deciden con
 * la misma pregunta «¿esta tarea sigue abierta?» desde dos runtimes: el `.mjs` no puede importar
 * el `.ts`, así que las reglas se mantienen a mano. Divergieron una vez y el cierre daba 22
 * falsos «sigue abierta» por IDs mencionados en «Bloqueos» y «Planes activos». Esta guarda
 * compara los dos veredictos sobre el mismo roadmap: si una regla cambia sin la otra, falla. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../../plataforma/sistema/temporales.js';
import { analizarRoadmap } from './roadmapAnalisis.js';

/* Un roadmap con la forma del protocolo y los casos que importan: abierta, cerrada y dos
 * menciones con casilla fuera de las zonas de tareas. */
const ROADMAP = [
  '# Roadmap',
  '',
  '## Pendientes',
  '',
  '- [ ] `T-1` — **Abierta de verdad.**',
  '- [x] `T-2` — **Cerrada.**',
  '',
  '## Bloqueos',
  '',
  '- `T-3` — **Mención sin casilla: no es tarea (los 22 falsos de 2026-10-19).**',
  '- [ ] `T-4` — **Con casilla: sigue siendo trabajo abierto.**',
  '',
  '## Planes activos',
  '',
  '- [ ] `T-5` — **Mención en planes: no es tarea.**',
  '',
].join('\n');

/* El cierre es `.mjs`: se carga por URL, como el gemelo de `plataforma/area.ts`. */
async function cargarComprobarRoadmap(): Promise<
  (ruta: string, tarea: string) => { ok: boolean; detalle: string }
> {
  const mod = (await import(new URL('../../../../scripts/dev/proyecto/cierre.mjs', import.meta.url).href)) as {
    comprobarRoadmap: (ruta: string, tarea: string) => { ok: boolean; detalle: string };
  };
  return mod.comprobarRoadmap;
}

describe('roadmap: el cierre y el tablero coinciden en qué sigue abierto', () => {
  let raiz: string;

  before(() => {
    mkdirSync(raizTemporales(), { recursive: true });
    raiz = mkdtempSync(join(raizTemporales(), 'roadmap-gemelos-'));
    writeFileSync(join(raiz, 'roadmap.md'), ROADMAP);
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('las dos reglas ven abiertas las mismas tareas', async () => {
    const comprobarRoadmap = await cargarComprobarRoadmap();
    const abiertasTablero = new Set(analizarRoadmap(ROADMAP).tareas.map((t) => t.id));
    for (const id of ['T-1', 'T-2', 'T-3', 'T-4', 'T-5']) {
      const abiertaCierre = !comprobarRoadmap(raiz, id).ok;
      assert.equal(abiertaCierre, abiertasTablero.has(id), `${id}: cierre=${abiertaCierre} tablero=${[...abiertasTablero].join(',')}`);
    }
    assert.deepEqual([...abiertasTablero].sort(), ['T-1', 'T-4']);
  });
});
