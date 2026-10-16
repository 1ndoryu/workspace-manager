/* Tests de los nombres de sesión del taller: los ids con espacio («PROYECTO TASKS») deben
 * dar el mismo nombre saneado en Mutagen y en tmux, y los ids normales no deben cambiar. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sesionDev, sesionMutagen, slugSesion } from './sesiones.js';

describe('slugSesion', () => {
  it('no cambia los ids normales', () => {
    assert.equal(slugSesion('MN-Inmobiliaria'), 'MN-Inmobiliaria');
    assert.equal(slugSesion('KAMPLES'), 'KAMPLES');
    assert.equal(slugSesion('RESTAURANTE'), 'RESTAURANTE');
  });

  it('sustituye el espacio (Mutagen lo rechaza en el nombre de sesión)', () => {
    assert.equal(slugSesion('PROYECTO TASKS'), 'PROYECTO-TASKS');
  });

  it('colapsa los caracteres no admitidos y conserva puntos, guiones y guion bajo', () => {
    assert.equal(slugSesion('a  b/c'), 'a-b-c');
    assert.equal(slugSesion('a.b_c-d'), 'a.b_c-d');
  });
});

describe('nombres de sesión', () => {
  it('Mutagen: taller-<id saneado>', () => {
    assert.equal(sesionMutagen('PROYECTO TASKS'), 'taller-PROYECTO-TASKS');
    assert.equal(sesionMutagen('KAMPLES'), 'taller-KAMPLES');
  });

  it('tmux: dev-<id saneado>-<puerto> (mismo saneado que Mutagen)', () => {
    assert.equal(sesionDev('PROYECTO TASKS', 4190), 'dev-PROYECTO-TASKS-4190');
    assert.equal(sesionDev('MN-Inmobiliaria', 3103), 'dev-MN-Inmobiliaria-3103');
  });
});
