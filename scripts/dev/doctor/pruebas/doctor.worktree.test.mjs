/* Tests de la detección de worktrees (falso positivo «dev sin botón»). Puros: no tocan disco. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoPrincipalDeArchivoGit } from '../worktree.mjs';

test('repoPrincipalDeArchivoGit: un .git-archivo de worktree apunta al repo principal', () => {
  const texto = 'gitdir: C:/area/glory-harness/.git/worktrees/glory-harness-19aa\n';
  assert.equal(repoPrincipalDeArchivoGit(texto), 'C:/area/glory-harness');
});

test('repoPrincipalDeArchivoGit: un repo normal (sin worktrees en la ruta) no es worktree', () => {
  assert.equal(repoPrincipalDeArchivoGit('gitdir: C:/area/otro/.git/modules/sub\n'), null);
  assert.equal(repoPrincipalDeArchivoGit(''), null);
  assert.equal(repoPrincipalDeArchivoGit(undefined), null);
});
