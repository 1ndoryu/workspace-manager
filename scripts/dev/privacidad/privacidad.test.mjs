/* Tests de privacidad.mjs (19AA-12). Los fixtures con datos que parecen personales
 * llevan la marca `privacidad:ignorar` para que el propio detector no se marque. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hallazgosEnTexto, reglaTermino, reglasPrivadas } from './privacidad.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const reglas = (texto, ruta = 'a.md', extra = []) => hallazgosEnTexto(texto, { ruta, reglas: extra }).map((h) => h.regla);

test('detecta rutas de usuario de Windows y de Linux', () => {
  assert.deepEqual(reglas('ruta C:\\Users\\usuario\\doc // privacidad:ignorar'), []);
  assert.deepEqual(reglas('mira C:\\Users\\perfil\\doc'), ['ruta-usuario-windows']);
  assert.deepEqual(reglas('cd /home/perfil/taller'), ['ruta-home-linux']);
});

test('no marca rutas genéricas sin nombre de usuario', () => {
  assert.deepEqual(reglas('ruta <HOME>/taller y %USERPROFILE%'), []);
});

test('no marca nombres de usuario de ejemplo (usuario, user)', () => {
  assert.deepEqual(reglas('C:\\Users\\usuario\\doc'), []);
  assert.deepEqual(reglas('/home/usuario/.cache'), []);
});

test('detecta IPs públicas y privadas pero no versiones de lockfile ni localhost ni documentación', () => {
  assert.deepEqual(reglas('host 8.8.8.8'), ['ip']);
  assert.deepEqual(reglas('servidor 10.0.0.5'), ['ip']);
  assert.deepEqual(reglas('escucha 127.0.0.1, 127.0.0.2 y 0.0.0.0'), []);
  assert.deepEqual(reglas('ejemplo 203.0.113.9 y 198.51.100.7'), []);
  assert.deepEqual(reglas('"version": "1.2.3.4"', 'package-lock.json'), []);
});

test('una expresión de código con nombre de variable no es un secreto', () => {
  assert.deepEqual(reglas('token: process.env.GLORY_QUALITY_GATE_TOKEN ?? null'), []);
});

test('no toma como IP un número con más octetos', () => {
  assert.deepEqual(reglas('versión 1.2.3.4.5'), []);
});

test('detecta tokens con forma conocida y asignaciones de secretos', () => {
  assert.deepEqual(reglas('token ghp_' + 'a'.repeat(36)), ['token']);
  /* [por que] Los valores se montan en vez de escribirse literales: el propio Sentinel marca
   * `password = "…"` como secreto hardcodeado y estos son fixtures. */
  assert.deepEqual(reglas('password = "' + 'a'.repeat(20) + '"'), ['secreto-asignado']);
  assert.deepEqual(reglas('password = "' + 'pendiente' + '"'), []);
});

test('el correo público no es dato personal', () => {
  assert.deepEqual(reglas('autor: andoryyu@gmail.com'), []);
});

test('la línea con la marca de excepción no se reporta', () => {
  assert.deepEqual(reglas('ruta C:\\Users\\usuario\\x // privacidad:ignorar'), []);
});

test('términos privados: coincidencia por palabra completa, sin mayúsculas', () => {
  const extra = [reglaTermino('mi-maquina')];
  assert.deepEqual(reglas('conecta a MI-MAQUINA hoy', 'a.md', extra), ['termino-privado']);
  assert.deepEqual(reglas('mi-maquina-2 no', 'a.md', extra), []);
});

test('términos con caracteres de regex se escapan', () => {
  const extra = [reglaTermino('host.raro')];
  assert.deepEqual(reglas('host.raro sí', 'a.md', extra), ['termino-privado']);
  assert.deepEqual(reglas('hostXraro no', 'a.md', extra), []);
});

test('el hallazgo oculta el dato: nunca lo repite completo', () => {
  const [h] = hallazgosEnTexto('ruta C:\\Users\\perfil\\doc', { ruta: 'a.md' });
  assert.ok(!h.fragmento.includes('Ana'));
});

test('reglasPrivadas: sin fichero no hay términos; con fichero, los lee', () => {
  const dir = mkdtempSync(join(tmpdir(), 'privacidad-'));
  try {
    assert.deepEqual(reglasPrivadas(join(dir, 'no-existe.json')), []);
    const ruta = join(dir, 'privacidad.local.json');
    writeFileSync(ruta, JSON.stringify({ terminos: ['mi-maquina', '', 3] }));
    assert.equal(reglasPrivadas(ruta).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
