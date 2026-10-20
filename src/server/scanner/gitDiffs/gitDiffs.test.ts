/* Tests de los diffs por archivo: la parte pura con texto fijo y detalleArchivos con un
 * puerto falso (sin repositorio). [por que] 19AA-13: al separar IO y pura, estas pruebas
 * cubren la lógica de topes y del porcelain sin depender de git. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { detalleArchivos } from '../gitDiffs.js';
import type { PuertoGit } from '../git.js';
import { leerPorcelain, MAX_BYTES_DIFF, recortar, rutaDiffSegura } from './puro.js';

test('rutaDiffSegura rechaza rutas absolutas, con .. o vacías', () => {
  assert.equal(rutaDiffSegura('a/b.ts'), true);
  assert.equal(rutaDiffSegura(''), false);
  assert.equal(rutaDiffSegura('/etc/passwd'), false);
  assert.equal(rutaDiffSegura('C:/x'), false);
  assert.equal(rutaDiffSegura('a/../b'), false);
  assert.equal(rutaDiffSegura('a//b'), false);
});

test('leerPorcelain separa entradas, untracked y renombros al destino', () => {
  const status = [' M src/a.ts', '?? nuevo.ts', '?? carpeta/', 'R  viejo.ts -> nuevo.ts'].join('\n');
  const { entradas, sinRastrear, truncado } = leerPorcelain(status, 200);
  assert.deepEqual(entradas.map((e) => e.ruta), ['src/a.ts', 'nuevo.ts', 'carpeta/', 'nuevo.ts']);
  assert.equal(entradas[3].estado, 'R ');
  assert.deepEqual(sinRastrear, ['nuevo.ts'], 'un directorio untracked no genera diff');
  assert.equal(truncado, false);
});

test('leerPorcelain corta en el tope y lo marca como truncado', () => {
  const { entradas, truncado } = leerPorcelain([' M a.ts', ' M b.ts', ' M c.ts'].join('\n'), 2);
  assert.equal(entradas.length, 2);
  assert.equal(truncado, true);
});

test('recortar devuelve el texto intacto o cortado con aviso', () => {
  assert.deepEqual(recortar('abc', 5), { texto: 'abc', cortado: false });
  assert.deepEqual(recortar('abcdef', 4), { texto: 'abcd', cortado: true });
});

test('detalleArchivos usa el puerto inyectado y no lanza git', () => {
  const consultas: string[] = [];
  const falso: PuertoGit = {
    git: (_ruta, args) => {
      consultas.push(args.join(' '));
      if (args[0] === 'status') return ' M src/a.ts';
      if (args.includes('--cached')) return 'diff staged';
      return 'diff unstaged';
    },
    gitAsync: async () => null,
  };
  const r = detalleArchivos('/proyecto', falso);
  assert.deepEqual(r.entradas, [{ estado: ' M', ruta: 'src/a.ts' }]);
  assert.equal(r.diffStaged, 'diff staged');
  assert.equal(r.diffUnstaged, 'diff unstaged');
  assert.equal(r.truncado, false);
  assert.equal(consultas.length, 3);
});

test('detalleArchivos marca truncado cuando el diff supera el tope', () => {
  const falso: PuertoGit = {
    git: (_ruta, args) => (args[0] === 'status' ? ' M a.ts' : args.includes('--cached') ? 'x'.repeat(MAX_BYTES_DIFF + 5) : ''),
    gitAsync: async () => null,
  };
  const r = detalleArchivos('/proyecto', falso);
  assert.equal(r.diffStaged.length, MAX_BYTES_DIFF);
  assert.equal(r.truncado, true);
});
