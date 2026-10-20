/* Tests de la validación de una entrada del registro: la marca `sinServicio` (proyecto sin
 * botón ni puertos) y el `host` sin espacios. Puros: la ruta es la raíz del repo, que existe. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAIZ_REPO } from '../base.mjs';
import { validarEntrada } from '../ficha/validacion.mjs';

const base = (extra = {}) => ({ id: 'proyecto-prueba', ruta: RAIZ_REPO, ...extra });

test('sinServicio: sin boton, puertos ni expectedCmdline la entrada es válida y queda vacía', () => {
  const e = base({ sinServicio: true });
  validarEntrada(e);
  assert.equal(e._avisoRegistro, undefined);
  assert.deepEqual(e.boton, []);
  assert.deepEqual(e.puertos, []);
});

test('sinServicio no admite boton, puertos ni expectedCmdline', () => {
  const e = base({ sinServicio: true, puertos: [1420] });
  validarEntrada(e);
  assert.match(e._avisoRegistro, /sinServicio no admite/);
});

test('sin sinServicio, boton es obligatorio aunque el tipoLauncher diga «sin servicio de red»', () => {
  const e = base({ tipoLauncher: 'sin servicio de red: app de escritorio' });
  validarEntrada(e);
  assert.match(e._avisoRegistro, /entrada sin 'boton'/);
});

test('sinServicio debe ser booleano', () => {
  const e = base({ sinServicio: 'si' });
  validarEntrada(e);
  assert.match(e._avisoRegistro, /sinServicio debe ser booleano/);
});

test('host con solo espacios no es un alias válido', () => {
  const e = base({ sinServicio: true, host: '   ' });
  validarEntrada(e);
  assert.match(e._avisoRegistro, /host debe ser un alias no vacio/);
});
