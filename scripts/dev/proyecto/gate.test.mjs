/* Tests del mando gate/comandos (10AA-2 F9.4-F9.5): parsers puros, sin backend. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsearArgsGate, rutaSnapshot, leerComandos, formatearNuevos, decidirAutogate, colaSalida, lineasAutogate, correrAutogate, ordenSubmodulosReplica, RAIZ } from './gate.mjs';
import { emergenciaLocal } from '../../shared/vps.mjs';

/* [por que] Sin VPS (config null) y sin --local el mando no analiza: falla con motivo. Con --local
 * la emergencia corre aquí y se avisa. La 89 (hostname del taller) siempre corre allí. */
test('emergenciaLocal: con VPS va a remoto; sin VPS falla salvo con --local', () => {
  const taller = { host: 'taller', hostnameTaller: 'taller-remoto' };
  assert.deepEqual(emergenciaLocal(['x', '--inicio'], taller, 'portatil'), { emergencia: false, aviso: undefined });
  assert.equal(emergenciaLocal(['x', '--inicio', '--local'], taller, 'portatil').emergencia, true);
  assert.match(emergenciaLocal(['x', '--local'], taller, 'portatil').aviso, /EMERGENCIA --local/);
  assert.throws(() => emergenciaLocal(['x', '--inicio'], null, 'portatil'), /sin VPS configurada/);
  assert.equal(emergenciaLocal(['x', '--local'], null, 'portatil').emergencia, true);
  assert.deepEqual(emergenciaLocal(['x', '--inicio'], taller, 'taller-remoto'), { emergencia: false, aviso: undefined });
});

test('parsearArgsGate exige id y exactamente un modo', () => {
  assert.deepEqual(parsearArgsGate(['agente-tiempo-real', '--inicio']), { id: 'agente-tiempo-real', modo: 'inicio', forzar: false, local: false, tarea: undefined });
  assert.deepEqual(parsearArgsGate(['agente-tiempo-real', '--cierre']), { id: 'agente-tiempo-real', modo: 'cierre', forzar: false, local: false, tarea: undefined });
  assert.equal(parsearArgsGate(['agente-tiempo-real', '--cierre', '--forzar']).forzar, true);
  assert.equal(parsearArgsGate(['agente-tiempo-real', '--cierre', '--local']).local, true);
  assert.ok(parsearArgsGate([]).error);
  assert.ok(parsearArgsGate(['--inicio']).error);
  assert.ok(parsearArgsGate(['x']).error);
  assert.ok(parsearArgsGate(['x', '--inicio', '--cierre']).error);
  assert.ok(parsearArgsGate(['x', '--inicio', '--raro']).error);
});

test('rutaSnapshot usa data/gate-inicio y admite espacios en la clave', () => {
  assert.equal(rutaSnapshot('app-tareas', RAIZ), join(RAIZ, 'data', 'gate-inicio', 'app-tareas.json'));
});

/* [por que] RAIZ se calcula contando carpetas desde este modulo, asi que moverlo
 * de sitio la desvia sin que nada falle: el snapshot acaba en scripts/data/ y el
 * `--cierre` compara contra una base vacia. El test anterior comparaba contra el
 * propio RAIZ, de modo que un RAIZ equivocado pasaba igual. Se ancla a un hecho
 * del disco (la raiz del repo es la que tiene el package.json del manager). */
test('RAIZ apunta a la raiz del repo, no a una carpeta intermedia', () => {
  const pkg = join(RAIZ, 'package.json');
  assert.ok(existsSync(pkg), `no hay package.json en RAIZ (${RAIZ})`);
  assert.equal(JSON.parse(readFileSync(pkg, 'utf8')).name, 'workspace-manager');
});

test('leerComandos acepta el contrato completo y null donde no aplica', () => {
  const r = leerComandos({ gate: 'node x.mjs gate', 'test-archivo': null, typecheck: 'npm run type-check', build: null });
  assert.equal(r.error, undefined);
  assert.equal(r.comandos.typecheck, 'npm run type-check');
});

test('leerComandos rechaza ausencia, claves desconocidas y textos vacíos', () => {
  assert.match(leerComandos(undefined).error, /sin contrato/);
  assert.match(leerComandos(['gate']).error, /debe ser un objeto/);
  assert.match(leerComandos({ lint: 'x' }).error, /clave desconocida 'lint'/);
  assert.match(leerComandos({ gate: '   ' }).error, /texto no vacío/);
  assert.match(leerComandos({ gate: 3 }).error, /texto no vacío/);
});

test('formatearNuevos imprime archivo:línea, regla y mensaje', () => {
  const lineas = formatearNuevos([{ archivo: 'src/a.ts', linea: 7, ruleId: 'regla-x', mensaje: 'algo' }]);
  assert.deepEqual(lineas, ['  src/a.ts:7  regla-x  algo']);
  assert.deepEqual(formatearNuevos([{ archivo: 'b.ts', ruleId: 'r', mensaje: 'm' }]), ['  b.ts:?  r  m']);
});

/* [por que] El autogate es obligatorio donde hay `comandos.gate`; lo que no lo tiene se omite con aviso
 * y no bloquea. En emergencia no corre en el portátil. */
test('decidirAutogate: corre comandos.gate, omite sin orden y nunca en emergencia', () => {
  assert.deepEqual(decidirAutogate({ comandos: { gate: 'npm run quality:check' } }, false), { estado: 'pendiente', orden: 'npm run quality:check' });
  assert.equal(decidirAutogate({ comandos: { gate: null } }, false).estado, 'omitido');
  assert.equal(decidirAutogate({}, false).estado, 'omitido');
  assert.equal(decidirAutogate({ comandos: { gate: 'npm test' } }, true).estado, 'omitido');
  assert.equal(decidirAutogate({ comandos: { lint: 'x' } }, false).estado, 'error');
});

test('colaSalida devuelve solo las últimas líneas', () => {
  assert.deepEqual(colaSalida('a\nb\nc\n', 2), ['b', 'c']);
});

test('lineasAutogate: un fallo muestra la cola y lleva el rc', () => {
  const lineas = lineasAutogate('x', { estado: 'fallo', rc: 1, orden: 'npm run quality:check', salida: 'uno\ndos' });
  assert.match(lineas[0], /autogate FALLÓ en la 89 \(rc 1/);
  assert.deepEqual(lineas.slice(1), ['uno', 'dos']);
  assert.match(lineasAutogate('x', { estado: 'omitido', motivo: 'm' })[0], /omitido: m/);
});

test('correrAutogate sin entrada en el registro es un error, no una omisión', () => {
  assert.equal(correrAutogate('no-existe', undefined, false).estado, 'error');
});

/* [10AA-3] La réplica de la 89 no sincroniza `.git`: el HEAD de los submódulos de herramientas
 * se queda viejo y su `git status` da por modificado todo lo que Mutagen copió. El gate de la 89
 * verifica el checkout por git, así que hay que alinearlo antes. `reset --mixed` mueve HEAD y el
 * índice sin tocar el árbol de trabajo (lo que Mutagen copió se queda como está). */
test('ordenSubmodulosReplica alinea cada submódulo al pin sin tocar el árbol', () => {
  const orden = ordenSubmodulosReplica('/srv/taller/proyecto', {
    tools: {
      sentinel: { sourcePath: 'tools/sentinel', commit: 'a'.repeat(40) },
      varsense: { sourcePath: '.quality-tools/varsense', commit: 'b'.repeat(40) },
    },
  });
  assert.match(orden, /git -C '\/srv\/taller\/proyecto\/tools\/sentinel' rev-parse HEAD/);
  assert.match(orden, /git -C '\/srv\/taller\/proyecto\/tools\/sentinel' reset --mixed 'a{40}'/);
  assert.match(orden, /\.quality-tools\/varsense/);
  // [por que] Nada de `checkout`: el árbol de trabajo es el que Mutagen acaba de copiar del portátil.
  assert.doesNotMatch(orden, /git -C '[^']*' checkout/);
});

test('ordenSubmodulosReplica ignora lo que no puede verificar y no inventa orden', () => {
  assert.equal(ordenSubmodulosReplica('/srv/p', { tools: {} }), null);
  assert.equal(ordenSubmodulosReplica('/srv/p', null), null);
  // Sin commit o sin sourcePath no hay nada que alinear.
  assert.equal(ordenSubmodulosReplica('/srv/p', { tools: { x: { sourcePath: 'tools/x' } } }), null);
  // Un sourcePath con metacaracteres de shell no se interpola jamás.
  const inyectado = ordenSubmodulosReplica('/srv/p', { tools: { x: { sourcePath: "tools/x'; rm -rf /", commit: 'c'.repeat(40) } } });
  assert.equal(inyectado, null);
});
