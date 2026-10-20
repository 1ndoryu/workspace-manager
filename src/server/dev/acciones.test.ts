/* Pruebas del ejecutor de acciones dev (F3). Solo la puerta de entrada: los ids
 * reales del registro llevan espacio («PROYECTO TASKS») y con la forma estricta
 * del puente toda accion sobre ellos moria con «id invalido» — el supervisor de
 * tuneles incluido, en silencio. Aqui se fija que el espacio pasa la forma y que
 * quien decide de verdad es el registro. No se lanza ningun hijo: los dos ids
 * son rechazados antes de invocar al CLI. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarAccionDev } from './acciones.js';

/* `up` es la accion que consulta el registro (arranqueMs) antes de invocar al
 * CLI: con un id ausente del registro lanza sin llegar a lanzar ningun hijo. */
async function motivo(id: string): Promise<string> {
  try {
    await ejecutarAccionDev('up', id);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return 'no fallo';
}

test('un id del registro con espacio no se rechaza por su forma', async () => {
  const m = await motivo('PROYECTO TASKS inexistente');
  assert.match(m, /sin entrada en registro/, 'el espacio debe pasar la forma; el registro es quien decide');
});

test('un id con forma imposible se rechaza antes de tocar el registro', async () => {
  assert.match(await motivo('mal id!'), /id invalido/);
  assert.match(await motivo(''), /id invalido/);
  assert.match(await motivo('../fuera'), /id invalido/);
});
