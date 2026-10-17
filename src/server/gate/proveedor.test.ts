/* Testigo del contrato de `ProveedorGate` (frente SOLID de 17AA-2).
 *
 * [por que] El fallo que se vigila aqui es de SUSTITUIBILIDAD: mientras `reglas()`
 * y `versionReferencia()` fueron obligatorias, varsense las cumplia con un
 * catalogo vacio y un `'—'`, y el cliente se veia obligado a ramificar por tipo
 * (`tipo === 'sentinel' ? reglasGate().reglas : []`) para no pintar basura. Un
 * contrato que obliga a mentir no es sustituible. El testigo comprueba que los
 * dos proveedores se consumen IGUAL, sin saber cual es cual.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esquemaGate } from './proveedor.js';
import { tiposDeGate } from '../../shared/gate/proveedores.js';
import { ESQUEMAS, esquemaPorArchivo, esquemaPorTipo } from '../../shared/gate/esquemas.js';

/* Positivo: los dos proveedores del gate estan registrados. Sin esto, un bucle
 * sobre cero proveedores pasaria el test sin probar nada. */
test('los dos proveedores del gate se resuelven y sirven esquema', () => {
  const tipos = tiposDeGate().sort();
  assert.deepEqual(tipos, ['sentinel', 'varsense']);
  for (const t of tipos) {
    const r = esquemaGate(t);
    assert.ok(r, `sin proveedor ${t}`);
    assert.equal(r.metadatos.tipo, t);
    assert.ok(r.esquemaText.length > 2, `esquema vacio en ${t}`);
    /* El numero que se sirve es el de las reglas que se sirven. */
    assert.equal(r.totalReglas, r.reglas.length, `totalReglas descuadrado en ${t}`);
  }
});

/* [por que] Este es el fallo exacto que se corrigio: el proveedor sin catalogo
 * declara `undefined` (no lo tiene) y el consumidor recibe cero reglas y `null`
 * de version, sin preguntar de que herramienta se trata. Antes varsense devolvia
 * `[]` y `'—'` — un valor que finge ser una version. */
test('un proveedor sin reglas ni version de referencia se consume sin ramificar', () => {
  const varsense = esquemaGate('varsense');
  assert.ok(varsense);
  assert.deepEqual(varsense.reglas, []);
  assert.equal(varsense.totalReglas, 0);
  assert.equal(varsense.metadatos.versionReferencia, null);

  const sentinel = esquemaGate('sentinel');
  assert.ok(sentinel);
  assert.ok(sentinel.reglas.length > 0, 'sentinel deberia traer catalogo');
  assert.equal(typeof sentinel.metadatos.versionReferencia, 'string');
});

/* [por que] El registro estatico sustituyo cuatro cadenas de `? :` (cliente y
 * server) que habia que tocar al anadir herramienta. Se comprueba que el mapa
 * por tipo y el mapa por archivo coinciden con la lista: si alguien anade una
 * entrada y se olvida de un campo, aqui salta. */
test('el registro estatico cubre los tipos y los nombres de archivo', () => {
  assert.deepEqual(
    ESQUEMAS.map((e) => e.tipo).sort(),
    tiposDeGate().sort(),
    'el registro estatico y los proveedores no cubren las mismas herramientas',
  );
  for (const e of ESQUEMAS) {
    assert.ok(e.archivo.endsWith('.config.json'), `archivo raro en ${e.tipo}: ${e.archivo}`);
    assert.ok(esquemaPorTipo(e.tipo), `sin esquema por tipo: ${e.tipo}`);
    assert.ok(esquemaPorArchivo(e.archivo), `sin esquema por archivo: ${e.archivo}`);
  }
  /* Un archivo que no es del gate no tiene esquema curado. */
  assert.equal(esquemaPorArchivo('taller.json'), undefined);
});
