/* Tests de los nombres de sesión del taller: los ids con espacio («PROYECTO TASKS») deben
 * dar el mismo nombre saneado en Mutagen y en tmux, y los ids normales no deben cambiar. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sesionDev, sesionMutagen, slugSesion } from './sesiones.js';

describe('slugSesion', () => {
  it('no cambia los ids normales', () => {
    assert.equal(slugSesion('sitio-api'), 'sitio-api');
    assert.equal(slugSesion('proyecto-a'), 'proyecto-a');
    assert.equal(slugSesion('sistema-legado'), 'sistema-legado');
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
    assert.equal(sesionMutagen('proyecto-a'), 'taller-proyecto-a');
  });

  it('tmux: dev-<id saneado>-<puerto> (mismo saneado que Mutagen)', () => {
    assert.equal(sesionDev('PROYECTO TASKS', 4190), 'dev-PROYECTO-TASKS-4190');
    assert.equal(sesionDev('sitio-api', 3103), 'dev-sitio-api-3103');
  });
});
