/* Puras del aviso «sin push»: solo cuentan los commits pendientes de subir, igual que el gate
 * (shared/gate/sincronizacion.ts). Sin remoto no hay nada que empujar, así que no es un problema.
 * Se corre con: node node_modules/tsx/dist/cli.mjs --test src/shared/consola/clasificacionConsola.git.test.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { categoriasDe, problemasDe } from './clasificacionConsola.js';
import type { Proyecto } from '../types.js';

/* Fixture minimo: solo los campos que lee la clasificacion de git. */
const conGit = (git: Record<string, unknown>): Proyecto =>
  ({
    id: 'demo',
    clave: 'demo',
    ruta: 'demo',
    esGit: true,
    tipo: 'repo',
    git: { dirty: false, cambios: { staged: 0, unstaged: 0, untracked: 0 }, worktreesOrfanos: [], remoto: 'origin', ahead: 0, ...git },
    gate: { declarado: true, sentinel: 'config', varsense: true, doctor: null, gateDisponible: true, puerta: 'sentinel' },
  }) as unknown as Proyecto;

describe('sinPush: solo commits pendientes de subir', () => {
  it('sin remoto y sin commits pendientes no avisa', () => {
    assert.equal(problemasDe(conGit({ remoto: null, ahead: 0 })), null);
  });

  it('con remoto y sin commits pendientes no avisa', () => {
    assert.equal(problemasDe(conGit({ remoto: 'origin', ahead: 0 })), null);
  });

  it('con commits pendientes avisa con su cuenta', () => {
    const p = problemasDe(conGit({ remoto: 'origin', ahead: 2 }));
    assert.ok(p);
    assert.deepEqual(categoriasDe(p), ['sinPush']);
    assert.equal(p.entradas[0].motivo, '2 commit(s) sin push');
  });
});
