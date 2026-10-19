/* [por que] separarVigencia decide qué se muestra en el tablero. Si deja pasar un dato de otro
 * HEAD, el tablero vuelve a mentir tras cada commit: por eso se prueba con datos sintéticos. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Proyecto } from '../../shared/types.js';
import { separarVigencia } from './vigencia.js';

const proyecto = (clave: string, head: string) => ({ clave, git: { head } }) as unknown as Proyecto;

test('solo devuelve lo guardado con la frescura actual', () => {
  const guardados: Record<string, { fresco: string; dato: string }> = {
    a: { fresco: 'head-1', dato: 'analisis-a' },
    b: { fresco: 'head-viejo', dato: 'analisis-b-obsoleto' },
  };
  const leerFresco = (clave: string, fresco: string) =>
    guardados[clave]?.fresco === fresco ? guardados[clave].dato : null;
  const frescoDe = (p: Proyecto) => (p.git as unknown as { head: string }).head;

  const r = separarVigencia([proyecto('a', 'head-1'), proyecto('b', 'head-nuevo'), proyecto('c', 'x')], frescoDe, leerFresco);

  assert.deepEqual(r.vigentes, ['analisis-a']);
  assert.deepEqual(r.desactualizados.map((p) => p.clave), ['b', 'c']);
});

test('sin proyectos no devuelve nada', () => {
  const r = separarVigencia<string>([], () => 'f', () => 'dato');
  assert.deepEqual(r, { vigentes: [], desactualizados: [] });
});
