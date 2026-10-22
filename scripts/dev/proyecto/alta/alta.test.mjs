/* Tests de alta.mjs (10AA-2 F10). Temporales en la raíz de temporales/alta-tests, nunca en el árbol del proyecto. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../../../shared/rutas.mjs';
import {
  aplicarAlta,
  alta,
  comprobarAlta,
  comprobarCargo,
  comprobarGitignore,
  comprobarQualityCheck,
  comprobarReadme,
  comprobarRoadmapAgente,
  comprobarSentinel,
  comprobarSinAgentsPropios,
  comprobarStack,
  comprobarVarsense,
} from './alta.mjs';

const BASE = join(raizTemporales(), 'alta-tests');
mkdirSync(BASE, { recursive: true });
after(() => rmSync(BASE, { recursive: true, force: true }));
const nuevoDir = () => mkdtempSync(join(BASE, 'caso-'));
const escribir = (ruta, rel, texto) => {
  mkdirSync(join(ruta, rel, '..'), { recursive: true });
  writeFileSync(join(ruta, rel), texto);
};
const git = (ruta, ...args) =>
  execFileSync('git', ['-C', ruta, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/* Repo con rama main y origin local (bare), como exige comprobarGit. */
function repo(ruta) {
  mkdirSync(ruta, { recursive: true });
  git(ruta, 'init', '-b', 'main');
  git(ruta, 'config', 'user.name', 'test');
  git(ruta, 'config', 'user.email', 'test@example.com');
  git(ruta, 'config', 'core.autocrlf', 'false');
  git(ruta, 'commit', '--allow-empty', '-m', 'init');
  const bare = `${ruta}-origin.git`;
  execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' });
  git(ruta, 'remote', 'add', 'origin', bare);
  return ruta;
}

/* Silencia la salida de alta() para que el reporte no ensucie la salida de test. */
async function silencio(fn) {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

const ENTRADA = { id: 'demo', comandos: { gate: 'npm run quality:check' } };
const SIN_GITIGNORE_SUFICIENTE = 'node_modules/\n';

/* Proyecto con todo lo de la lista salvo lo que cada test quita o añade. */
function proyectoCompleto(ruta) {
  repo(ruta);
  return archivosCompletos(ruta);
}

/* Solo los ficheros de la lista, sobre un repo ya creado. */
function archivosCompletos(ruta) {
  escribir(ruta, 'package.json', JSON.stringify({ scripts: { 'quality:check': 'echo ok' } }));
  escribir(ruta, 'README.md', '# demo\n');
  escribir(ruta, 'roadmap.md', '# Roadmap\n');
  for (const c of ['completados', 'documentacion', 'lecciones', 'planes', 'prevencion']) {
    escribir(ruta, `Agente/${c}/.gitkeep`, '');
  }
  escribir(ruta, 'sentinel.config.json', JSON.stringify({ schemaVersion: 2 }));
  escribir(ruta, '.gitignore', 'target/\nnode_modules/\n.quality-reports/\n.runtime/\n');
  return ruta;
}

test('stack: sin manifiesto falla; con package.json detecta node', () => {
  const vacio = nuevoDir();
  assert.equal(comprobarStack(vacio).ok, false);
  escribir(vacio, 'package.json', '{}');
  const r = comprobarStack(vacio);
  assert.equal(r.ok, true);
  assert.match(r.detalle, /node/);
});

test('stack: un manifiesto en subcarpeta (pulse/Cargo.toml) cuenta; scripts/ no', () => {
  const anidado = nuevoDir();
  mkdirSync(join(anidado, 'pulse'));
  escribir(anidado, 'pulse/Cargo.toml', '[package]');
  assert.match(comprobarStack(anidado).detalle, /rust/);
  const soloScripts = nuevoDir();
  mkdirSync(join(soloScripts, 'scripts'));
  escribir(soloScripts, 'scripts/package.json', '{}');
  assert.equal(comprobarStack(soloScripts).ok, false);
});

test('readme: sin README propone crearlo en el bloque docs', () => {
  const dir = nuevoDir();
  const r = comprobarReadme(dir, 'demo');
  assert.equal(r.ok, false);
  assert.equal(r.bloque, 'docs');
  assert.equal(r.acciones[0].ruta, 'README.md');
});

test('roadmap-agente: falta todo, luego completo', () => {
  const dir = nuevoDir();
  const r = comprobarRoadmapAgente(dir);
  assert.equal(r.ok, false);
  assert.ok(r.acciones.some((a) => a.ruta === 'roadmap.md'));
  assert.ok(r.acciones.some((a) => a.ruta === 'Agente/planes/.gitkeep'));
  for (const c of ['completados', 'documentacion', 'lecciones', 'planes', 'prevencion']) {
    escribir(dir, `Agente/${c}/.gitkeep`, '');
  }
  escribir(dir, 'roadmap.md', '# R\n');
  assert.equal(comprobarRoadmapAgente(dir).ok, true);
});

test('gitignore: sin fichero propone las cuatro líneas; variantes con / cuentan', () => {
  const dir = nuevoDir();
  const r = comprobarGitignore(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.acciones[0].lineas, ['target/', 'node_modules/', '.quality-reports/', '.runtime/']);
  escribir(dir, '.gitignore', SIN_GITIGNORE_SUFICIENTE);
  assert.equal(comprobarGitignore(dir).ok, false);
  escribir(dir, '.gitignore', '/target\nnode_modules\n/.quality-reports/\n/.runtime\n');
  assert.equal(comprobarGitignore(dir).ok, true);
});

test('cargo-target: no Rust se omite; Rust sin target-dir falla; con target-dir pasa', () => {
  const dir = nuevoDir();
  assert.equal(comprobarCargo(dir).ok, true);
  escribir(dir, 'Cargo.toml', '[package]\nname = "x"\n');
  assert.equal(comprobarCargo(dir).ok, false);
  escribir(dir, '.cargo/config.toml', '[build]\ntarget-dir = "C:/tmp/proyecto-target/x"\n');
  assert.equal(comprobarCargo(dir).ok, true);
});

test('varsense: sin CSS se omite; con CSS exige varsense.config.json', () => {
  const dir = nuevoDir();
  assert.equal(comprobarVarsense(dir).ok, true);
  escribir(dir, 'src/app.css', 'a{}');
  assert.equal(comprobarVarsense(dir).ok, false);
  escribir(dir, 'varsense.config.json', '{}');
  assert.equal(comprobarVarsense(dir).ok, true);
});

test('varsense: el CSS de node_modules no cuenta', () => {
  const dir = nuevoDir();
  escribir(dir, 'node_modules/pkg/x.css', 'a{}');
  assert.equal(comprobarVarsense(dir).ok, true);
});

test('sentinel: exige schemaVersion 2', () => {
  const dir = nuevoDir();
  assert.equal(comprobarSentinel(dir).ok, false);
  escribir(dir, 'sentinel.config.json', JSON.stringify({ schemaVersion: 1 }));
  assert.equal(comprobarSentinel(dir).ok, false);
  escribir(dir, 'sentinel.config.json', JSON.stringify({ schemaVersion: 2 }));
  assert.equal(comprobarSentinel(dir).ok, true);
});

test('quality-check: con package.json exige el script; sin él usa comandos.gate', () => {
  const dir = nuevoDir();
  assert.equal(comprobarQualityCheck(dir, ENTRADA).ok, true);
  assert.equal(comprobarQualityCheck(dir, {}).ok, false);
  escribir(dir, 'package.json', JSON.stringify({ scripts: { build: 'x' } }));
  assert.equal(comprobarQualityCheck(dir, ENTRADA).ok, false);
  escribir(dir, 'package.json', JSON.stringify({ scripts: { 'quality:check': 'x' } }));
  assert.equal(comprobarQualityCheck(dir, ENTRADA).ok, true);
});

test('sin AGENTS/CLAUDE propios: los detecta', () => {
  const dir = nuevoDir();
  assert.equal(comprobarSinAgentsPropios(dir).ok, true);
  escribir(dir, 'CLAUDE.md', '# x');
  const r = comprobarSinAgentsPropios(dir);
  assert.equal(r.ok, false);
  assert.match(r.detalle, /CLAUDE\.md/);
});

test('comprobarAlta: devuelve los 11 puntos de la lista canónica', () => {
  const dir = proyectoCompleto(nuevoDir());
  const items = comprobarAlta(dir, ENTRADA, 'demo');
  assert.equal(items.length, 11);
  assert.deepEqual(
    items.filter((i) => !i.ok).map((i) => i.nombre),
    [],
  );
});

test('aplicar: crea en rama alta/10aa-2 con un commit por bloque y no toca lo existente', () => {
  const dir = repo(nuevoDir());
  escribir(dir, '.gitignore', 'node_modules/\n');
  git(dir, 'add', '.gitignore');
  git(dir, 'commit', '-m', 'ignore previo');
  const items = comprobarAlta(dir, ENTRADA, 'demo');
  const lineas = aplicarAlta(dir, items);
  assert.ok(lineas.some((l) => l.includes('commit docs')));
  assert.ok(lineas.some((l) => l.includes('commit gitignore')));
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'alta/10aa-2');
  assert.equal(git(dir, 'log', '--format=%s', 'main..HEAD').split('\n').length, 2);
  assert.ok(existsSync(join(dir, 'roadmap.md')));
  const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /^node_modules\/$/m, 'conserva la línea previa');
  assert.match(gi, /^target\/$/m);
});

test('aplicar: lo que .gitignore declara local se crea en disco sin commit', () => {
  const dir = repo(nuevoDir());
  escribir(dir, '.gitignore', 'Agente/\n');
  git(dir, 'add', '.gitignore');
  git(dir, 'commit', '-m', 'ignore previo');
  aplicarAlta(dir, comprobarAlta(dir, ENTRADA, 'demo'));
  assert.ok(existsSync(join(dir, 'Agente', 'lecciones', '.gitkeep')));
  assert.equal(git(dir, 'ls-files', 'Agente'), '');
});

test('aplicar: bloque solo local no deja una rama vacía', () => {
  const dir = repo(nuevoDir());
  escribir(dir, 'README.md', '# demo\n');
  escribir(dir, 'roadmap.md', '# Roadmap\n');
  escribir(dir, '.gitignore', 'Agente/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'base');
  const docs = comprobarAlta(dir, ENTRADA, 'demo').filter((i) => i.bloque === 'docs');
  const lineas = aplicarAlta(dir, docs);
  assert.ok(lineas.some((l) => l.includes('sin cambios que versionar')), JSON.stringify(lineas));
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(git(dir, 'branch', '--list', 'alta/10aa-2'), '');
});

test('aplicar: se niega fuera de la rama base', () => {
  const dir = repo(nuevoDir());
  git(dir, 'checkout', '-b', 'otra');
  assert.throws(() => aplicarAlta(dir, comprobarAlta(dir, ENTRADA, 'demo')), /estás en otra/);
});

test('aplicar: se niega si la rama alta/10aa-2 ya existe', () => {
  const dir = repo(nuevoDir());
  git(dir, 'branch', 'alta/10aa-2');
  assert.throws(() => aplicarAlta(dir, comprobarAlta(dir, ENTRADA, 'demo')), /ya existe/);
});

test('aplicar: sin nada pendiente no crea rama', () => {
  const dir = proyectoCompleto(nuevoDir());
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'alta completa');
  assert.deepEqual(aplicarAlta(dir, comprobarAlta(dir, ENTRADA, 'demo')), ['nada que aplicar']);
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
});

test('alta(): en seco devuelve 1 en un proyecto incompleto y 0 en uno completo', async () => {
  const raiz = nuevoDir();
  escribir(
    raiz,
    'config/registro.json',
    JSON.stringify({ proyectos: [{ id: 'demo', ruta: 'proy', comandos: ENTRADA.comandos }] }),
  );
  const proy = join(raiz, 'proy');
  repo(proy);
  assert.equal(await silencio(() => alta(['demo'], raiz)), 1);
  archivosCompletos(proy);
  git(proy, 'add', '-A');
  git(proy, 'commit', '-m', 'alta completa');
  assert.equal(await silencio(() => alta(['demo'], raiz)), 0);
});

test('alta(): id inexistente devuelve 1 sin lanzar', async () => {
  const raiz = nuevoDir();
  escribir(raiz, 'config/registro.json', JSON.stringify({ proyectos: [] }));
  assert.equal(await silencio(() => alta(['no-existe'], raiz)), 1);
});

test('alta(--json): imprime solo JSON con estado por ítem y código 1 si faltan', async () => {
  const raiz = nuevoDir();
  escribir(
    raiz,
    'config/registro.json',
    JSON.stringify({ proyectos: [{ id: 'demo', ruta: 'proy', comandos: ENTRADA.comandos }] }),
  );
  const proy = join(raiz, 'proy');
  repo(proy);
  const salida = [];
  const log = console.log;
  console.log = (t) => salida.push(t);
  let codigo;
  try {
    codigo = await alta(['demo', '--json'], raiz);
  } finally {
    console.log = log;
  }
  assert.equal(codigo, 1);
  assert.equal(salida.length, 1);
  const obj = JSON.parse(salida[0]);
  assert.equal(obj.etiqueta, 'demo');
  assert.equal(obj.total, 11);
  assert.equal(obj.hechos + obj.items.filter((it) => !it.ok).length, 11);
  assert.ok(obj.items.every((it) => !('acciones' in it) && !('bloque' in it)));
});

test('alta(--json --aplicar): se niega sin tocar nada', async () => {
  const raiz = nuevoDir();
  escribir(raiz, 'config/registro.json', JSON.stringify({ proyectos: [] }));
  assert.equal(await silencio(() => alta(['demo', '--json', '--aplicar'], raiz)), 1);
});
