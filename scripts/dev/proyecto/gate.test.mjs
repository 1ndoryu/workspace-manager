/* Tests del mando gate/comandos (10AA-2 F9.4-F9.5): parsers puros, sin backend. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsearArgsGate, rutaSnapshot, leerComandos, formatearNuevos, RAIZ } from './gate.mjs';
import { emergenciaLocal } from '../../shared/vps.mjs';

/* [por que] Sin VPS (config null) y sin --local el mando no analiza: falla con motivo. Con --local
 * la emergencia corre aquí y se avisa. La 89 (hostname del taller) siempre corre allí. */
test('emergenciaLocal: con VPS va a remoto; sin VPS falla salvo con --local', () => {
  const taller = { host: 'dev89', hostnameTaller: 'vmi-taller' };
  assert.deepEqual(emergenciaLocal(['x', '--inicio'], taller, 'Wan'), { emergencia: false, aviso: undefined });
  assert.equal(emergenciaLocal(['x', '--inicio', '--local'], taller, 'Wan').emergencia, true);
  assert.match(emergenciaLocal(['x', '--local'], taller, 'Wan').aviso, /EMERGENCIA --local/);
  assert.throws(() => emergenciaLocal(['x', '--inicio'], null, 'Wan'), /sin VPS configurada/);
  assert.equal(emergenciaLocal(['x', '--local'], null, 'Wan').emergencia, true);
  assert.deepEqual(emergenciaLocal(['x', '--inicio'], taller, 'vmi-taller'), { emergencia: false, aviso: undefined });
});

test('parsearArgsGate exige id y exactamente un modo', () => {
  assert.deepEqual(parsearArgsGate(['agente-tiempo-real', '--inicio']), { id: 'agente-tiempo-real', modo: 'inicio', forzar: false, local: false });
  assert.deepEqual(parsearArgsGate(['agente-tiempo-real', '--cierre']), { id: 'agente-tiempo-real', modo: 'cierre', forzar: false, local: false });
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
