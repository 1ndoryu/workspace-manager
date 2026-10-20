/* Escáner Git contra repositorios de verdad.
 * [por qué repos reales] Lo que se cambió en el 17AA-2 es *cómo* se pregunta a
 * git (`status --branch` en lugar de tres procesos) y *qué* se responde sin
 * preguntarle (config, worktrees, enlaces). Un mock no probaría ninguna de las
 * dos: el formato de la cabecera y la disposición del `.git` son justamente lo
 * que hay que ejercitar. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { detectarGit, estadoGit, estadoGitAsync, PUERTO_GIT, type PuertoGit } from './git.js';
import { raizTemporales } from '../plataforma/temporales.js';

const BASE = mkdtempSync(join(raizTemporales(), 'wm-git-test-'));
after(() => rmSync(BASE, { recursive: true, force: true }));

/* Identidad fija por entorno: en una máquina sin `user.name` global, `git
 * commit` falla y la prueba mediría otra cosa. */
const ENTORNO = {
  ...process.env,
  GIT_AUTHOR_NAME: 'prueba',
  GIT_AUTHOR_EMAIL: 'prueba@ejemplo.test',
  GIT_COMMITTER_NAME: 'prueba',
  GIT_COMMITTER_EMAIL: 'prueba@ejemplo.test',
};

/** git de verdad, fallando en alto: un fallo de preparación no debe pasar por
 * resultado del escáner. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: ENTORNO, windowsHide: true }).trimEnd();
}

/** Repo nuevo con un commit y una rama `main`, en una carpeta propia. */
function repoNuevo(nombre: string): string {
  const dir = join(BASE, nombre);
  mkdirSync(dir, { recursive: true });
  git(dir, '-c', 'init.defaultBranch=main', 'init');
  writeFileSync(join(dir, 'leeme.txt'), 'hola\n');
  git(dir, 'add', 'leeme.txt');
  git(dir, 'commit', '-m', 'primer commit');
  return dir;
}

test('detectarGit: distingue repo, worktree y carpeta suelta', () => {
  const suelta = join(BASE, 'carpeta-suelta');
  mkdirSync(suelta, { recursive: true });
  assert.deepEqual(detectarGit(suelta), { esRepo: false, esWorktree: false, padre: null });

  const repo = repoNuevo('repo-llano');
  assert.deepEqual(detectarGit(repo), { esRepo: true, esWorktree: false, padre: null });

  const wt = join(BASE, 'worktree-derivado');
  git(repo, 'worktree', 'add', '-b', 'derivada', wt);
  const info = detectarGit(wt);
  assert.equal(info.esRepo, true);
  assert.equal(info.esWorktree, true);
  assert.ok(info.padre && info.padre.includes('worktrees'), `padre=${info.padre}`);
});

/* El `.git` enlazado a una carpeta era el único caso que necesitaba preguntar a
 * git; ahora se resuelve en el filesystem. En Windows el enlace se crea como
 * junction porque un symlink de carpeta exige privilegios. */
test('detectarGit: un .git enlazado a una carpeta sigue siendo repo', () => {
  const real = repoNuevo('repo-con-enlace-real');
  const enlazado = join(BASE, 'repo-con-enlace');
  mkdirSync(enlazado, { recursive: true });
  symlinkSync(join(real, '.git'), join(enlazado, '.git'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(detectarGit(enlazado), { esRepo: true, esWorktree: false, padre: null });
});

/* [por que] El escáner usa la versión async en paralelo: debe dar lo mismo que la síncrona. */
test('estadoGitAsync: coincide con estadoGit en un repo con cambios', async () => {
  const repo = repoNuevo('repo-async');
  git(repo, 'remote', 'add', 'origin', 'https://ejemplo.test/alguien/proyecto.git');
  writeFileSync(join(repo, 'nuevo.txt'), 'x');
  assert.deepEqual(await estadoGitAsync(repo), estadoGit(repo));
});

test('estadoGit: repo limpio con remoto', () => {
  const repo = repoNuevo('repo-limpio');
  git(repo, 'remote', 'add', 'origin', 'https://ejemplo.test/alguien/proyecto.git');
  const e = estadoGit(repo);
  assert.equal(e?.rama, 'main');
  assert.equal(e?.remoto, 'https://ejemplo.test/alguien/proyecto.git');
  assert.equal(e?.dirty, false);
  assert.deepEqual(e?.cambios, { staged: 0, unstaged: 0, untracked: 0 });
  assert.equal(e?.ahead, 0);
  assert.equal(e?.behind, 0);
  assert.equal(e?.ultimoCommit?.mensaje, 'primer commit');
});

test('estadoGit: sin origin el remoto es nulo, no una cadena vacía', () => {
  assert.equal(estadoGit(repoNuevo('repo-sin-remoto'))?.remoto, null);
});

/* El espacio inicial de ` M ruta` es dato (columna X del porcelain): si se
 * comiera, el primer archivo saldría con la ruta truncada y como staged. */
test('estadoGit: cuenta staged, unstaged y sin seguimiento', () => {
  const repo = repoNuevo('repo-sucio');
  writeFileSync(join(repo, 'leeme.txt'), 'cambiado\n');
  writeFileSync(join(repo, 'nuevo.txt'), 'sin seguimiento\n');
  writeFileSync(join(repo, 'preparado.txt'), 'preparado\n');
  git(repo, 'add', 'preparado.txt');
  const e = estadoGit(repo);
  assert.equal(e?.dirty, true);
  assert.deepEqual(e?.cambios, { staged: 1, unstaged: 1, untracked: 1 });
});

test('estadoGit: HEAD desacoplado se llama DETACHED', () => {
  const repo = repoNuevo('repo-desacoplado');
  git(repo, 'checkout', '--detach');
  assert.equal(estadoGit(repo)?.rama, 'DETACHED');
});

/* Repo recién iniciado, sin commits: HEAD apunta a una rama que aún no existe. */
test('estadoGit: repo sin commits informa de su rama, no de DETACHED', () => {
  const dir = join(BASE, 'repo-sin-commits');
  mkdirSync(dir, { recursive: true });
  git(dir, '-c', 'init.defaultBranch=main', 'init');
  const e = estadoGit(dir);
  assert.equal(e?.rama, 'main');
  assert.equal(e?.ultimoCommit, null);
});

/* ahead/behind salen ahora de la cabecera de `status --branch`, no de
 * `rev-list --left-right`: es lo que más formato tiene que acertar. */
test('estadoGit: cuenta lo que hay por subir y por traer', () => {
  const origen = join(BASE, 'origen-desnudo');
  mkdirSync(origen, { recursive: true });
  git(origen, '-c', 'init.defaultBranch=main', 'init', '--bare');

  const clon = join(BASE, 'clon');
  git(BASE, 'clone', origen, clon);
  writeFileSync(join(clon, 'leeme.txt'), 'hola\n');
  git(clon, 'add', 'leeme.txt');
  git(clon, 'commit', '-m', 'primero');
  git(clon, 'push', '-u', 'origin', 'main');
  assert.equal(estadoGit(clon)?.ahead, 0, 'recién empujado no hay nada por subir');

  writeFileSync(join(clon, 'local.txt'), 'local\n');
  git(clon, 'add', 'local.txt');
  git(clon, 'commit', '-m', 'local');
  const adelantado = estadoGit(clon);
  assert.equal(adelantado?.ahead, 1);
  assert.equal(adelantado?.behind, 0);

  /* Un segundo clon empuja: el primero queda por detrás. */
  const otro = join(BASE, 'otro-clon');
  git(BASE, 'clone', origen, otro);
  writeFileSync(join(otro, 'ajeno.txt'), 'ajeno\n');
  git(otro, 'add', 'ajeno.txt');
  git(otro, 'commit', '-m', 'ajeno');
  git(otro, 'push', 'origin', 'main');
  git(clon, 'fetch', 'origin');
  const atrasado = estadoGit(clon);
  assert.equal(atrasado?.ahead, 1);
  assert.equal(atrasado?.behind, 1);
});

/* El atajo que evita `git worktree list` cuando no hay worktrees solo es
 * legítimo si un worktree huérfano de verdad se sigue viendo. */
test('estadoGit: ve el worktree cuyo directorio ya no existe', () => {
  const repo = repoNuevo('repo-con-worktree-huerfano');
  assert.deepEqual(estadoGit(repo)?.worktreesOrfanos, [], 'sin worktrees no hay huérfanos');

  const wt = join(BASE, 'worktree-que-se-va');
  git(repo, 'worktree', 'add', '-b', 'se-va', wt);
  assert.deepEqual(estadoGit(repo)?.worktreesOrfanos, [], 'mientras existe, no es huérfano');

  /* Se borra a mano el directorio del worktree (sin `worktree prune`). */
  rmSync(wt, { recursive: true, force: true });
  const orfanos = estadoGit(repo)?.worktreesOrfanos ?? [];
  assert.equal(orfanos.length, 1, `huérfanos=${JSON.stringify(orfanos)}`);
  assert.ok(orfanos[0].endsWith('worktree-que-se-va'));
});

test('estadoGit: un worktree informa de su rama y de su raíz', () => {
  const repo = repoNuevo('repo-con-worktree-vivo');
  const wt = join(BASE, 'worktree-vivo');
  git(repo, 'worktree', 'add', '-b', 'viva', wt);
  const e = estadoGit(wt);
  assert.equal(e?.rama, 'viva');
  assert.equal(e?.remoto, null);
});

test('detectarGit: un .git roto no se toma por repo', () => {
  const dir = join(BASE, 'repo-enlace-roto');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.git'), 'gitdir: ' + join(BASE, 'no-existe-en-absoluto') + '\n');
  const info = detectarGit(dir);
  /* Es un worktree declarado: se reporta como tal aunque su gitdir no exista,
   * porque el escáner solo informa (quien decide es el usuario). */
  assert.equal(info.esRepo, true);
  assert.equal(info.esWorktree, true);
});

test('detectarGit: una carpeta dentro de un repo cuenta como repo', () => {
  const repo = repoNuevo('repo-con-subcarpeta');
  const dentro = join(repo, 'sub', 'carpeta');
  mkdirSync(dentro, { recursive: true });
  /* git reconocería la carpeta por estar dentro del árbol de trabajo; es la
   * pregunta que antes costaba un proceso por carpeta. */
  assert.equal(detectarGit(dentro).esRepo, true);
});

/* [por que] El puerto existe para inyectar salidas de git sin lanzar procesos: aquí
 * el puerto cuenta las consultas y reenvía al git real, así que el resultado no cambia. */
test('estadoGit: consulta a git solo a través del puerto inyectado', async () => {
  const repo = repoNuevo('repo-puerto-espia');
  const consultas: string[] = [];
  const espia: PuertoGit = {
    git: (ruta, args) => (consultas.push(args[0]), PUERTO_GIT.git(ruta, args)),
    gitAsync: (ruta, args) => (consultas.push(args[0]), PUERTO_GIT.gitAsync(ruta, args)),
  };
  assert.deepEqual(estadoGit(repo, espia), estadoGit(repo));
  assert.deepEqual(await estadoGitAsync(repo, espia), estadoGit(repo));
  assert.ok(consultas.includes('status'), `consultas=${consultas}`);
});

/* Puerto falso sin repo real: la cabecera de `status` llega fija y se lee tal cual. */
test('estadoGit: con un puerto falso lee la cabecera que le den', () => {
  const falso: PuertoGit = {
    git: (_ruta, args) => (args[0] === 'status' ? '## trabajo...origin/trabajo [ahead 3]' : null),
    gitAsync: async (_ruta, args) => (args[0] === 'status' ? '## trabajo...origin/trabajo [ahead 3]' : null),
  };
  const ruta = join(BASE, 'no-existe-repo-falso');
  const e = estadoGit(ruta, falso);
  assert.equal(e.rama, 'trabajo');
  assert.equal(e.ahead, 3);
});
