/* Test de la plantilla por stack (F11.4). Se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/guardian/plantilla.test.ts`.
 * Fixtures en C:/tmp (protocolo de temporales).
 * [por que] El texto de referencia es el ejemplo versionado, no la plantilla real:
 * la real es config privada y no existe en un clon limpio. Así el test corre en
 * cualquier clon y, de paso, comprueba que el ejemplo que se publica es válido. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eolDe, hashDe } from '../escritura.js';
import {
  calcularEdicionPlantilla,
  guardarEdicionPlantilla,
  leerPlantilla,
  NOMBRE_PLANTILLA,
  serializarPlantilla,
  validarPlantilla,
} from './plantilla.js';

/* El ejemplo vive en el repo: sube 4 niveles desde configuracion/ hasta su raíz. */
const EJEMPLO = join(import.meta.dirname, '..', '..', '..', '..', 'config', 'ejemplos', 'guard-plantillas.example.json');
const TEXTO_REAL = readFileSync(EJEMPLO, 'utf8');

const BASE_TMP = 'C:/tmp/guardian-test';
const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

function raizTmp(contenido: string | null = TEXTO_REAL): string {
  mkdirSync(BASE_TMP, { recursive: true });
  const d = mkdtempSync(join(BASE_TMP, 'plantilla-'));
  temporales.push(d);
  if (contenido !== null) writeFileSync(join(d, NOMBRE_PLANTILLA), contenido, 'utf8');
  return d;
}

function hashActual(raiz: string): string {
  const l = leerPlantilla(raiz);
  if (l.estado !== 'ok') throw new Error(JSON.stringify(l));
  return l.hash;
}

/* Copia de la plantilla real con un proyecto más. */
function entradaConRepo(nombre: string, stacks: string[]): unknown {
  const json = JSON.parse(TEXTO_REAL) as { stackDeProyecto: Record<string, string[]> };
  json.stackDeProyecto[nombre] = stacks;
  return json;
}

describe('serializarPlantilla', () => {
  it('reproduce la plantilla real sin diferencias', () => {
    const v = validarPlantilla(JSON.parse(TEXTO_REAL));
    assert.equal(v.ok, true);
    if (!v.ok) return;
    /* La plantilla real usa CRLF: la serialización debe reproducir ese mismo fin de línea. */
    assert.equal(serializarPlantilla(v.plantilla, eolDe(TEXTO_REAL)), TEXTO_REAL);
  });
  it('plantilla vacía con listas inline y vacías', () => {
    const texto = serializarPlantilla({ schemaVersion: 1, quitarDeTools: [], plantillas: {}, stackDeProyecto: {} }, '\n');
    assert.equal(texto, '{\n  "schemaVersion": 1,\n  "quitarDeTools": [],\n  "plantillas": {},\n  "stackDeProyecto": {}\n}\n');
  });
  it('respeta CRLF sin mezclar finales de línea', () => {
    const texto = serializarPlantilla({ schemaVersion: 1, quitarDeTools: ['git'], plantillas: {}, stackDeProyecto: {} }, '\r\n');
    assert.ok(texto.includes('\r\n'));
    assert.equal(texto.replace(/\r\n/gu, '').includes('\n'), false);
  });
});

describe('validarPlantilla', () => {
  it('acepta nombres de proyecto con espacios y barras, y stack vacío', () => {
    const v = validarPlantilla(entradaConRepo('trabajos cliente/uno dos', []));
    assert.equal(v.ok, true);
  });
  it('rechaza schemaVersion distinta de 1', () => {
    const json = JSON.parse(TEXTO_REAL) as Record<string, unknown>;
    json.schemaVersion = 2;
    assert.equal(validarPlantilla(json).ok, false);
  });
  it('rechaza una lista desconocida dentro de un stack', () => {
    const json = JSON.parse(TEXTO_REAL) as { plantillas: Record<string, Record<string, string[]>> };
    json.plantillas.ts.otra = ['x'];
    const v = validarPlantilla(json);
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.motivo.includes('lista desconocida'));
  });
  it('rechaza un stack de proyecto sin plantilla', () => {
    const v = validarPlantilla(entradaConRepo('mi-app', ['go']));
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.motivo.includes('no tiene plantilla'));
  });
  it('rechaza metacaracteres en quitarDeTools', () => {
    const json = JSON.parse(TEXTO_REAL) as { quitarDeTools: string[] };
    json.quitarDeTools = ['git && rm'];
    assert.equal(validarPlantilla(json).ok, false);
  });
  it('rechaza una raíz que no es objeto', () => {
    assert.equal(validarPlantilla([]).ok, false);
  });
});

describe('leerPlantilla', () => {
  it('ausente si no existe el fichero', () => {
    assert.equal(leerPlantilla(raizTmp(null)).estado, 'ausente');
  });
  it('invalida con JSON roto', () => {
    const l = leerPlantilla(raizTmp('{no json'));
    assert.equal(l.estado, 'invalida');
    if (l.estado === 'invalida') assert.equal(l.motivo, 'JSON no válido');
  });
  it('ok con el ejemplo y hash de su texto', () => {
    const l = leerPlantilla(raizTmp());
    assert.equal(l.estado, 'ok');
    if (l.estado !== 'ok') return;
    assert.equal(l.hash, hashDe(TEXTO_REAL));
    assert.deepEqual(l.plantilla.plantillas.rust.cargoSubcommands?.includes('nextest'), true);
  });
  it('symlink → invalida (no se edita fuera del tablero)', (t) => {
    const destino = raizTmp();
    const raiz = raizTmp(null);
    try {
      symlinkSync(join(destino, NOMBRE_PLANTILLA), join(raiz, NOMBRE_PLANTILLA), 'file');
    } catch {
      t.skip('sin permiso para crear symlinks en Windows');
      return;
    }
    assert.equal(leerPlantilla(raiz).estado, 'invalida');
  });
});

describe('calcularEdicionPlantilla y guardarEdicionPlantilla', () => {
  it('hash previo distinto → conflicto, sin escribir', () => {
    const r = raizTmp();
    const res = calcularEdicionPlantilla(r, 'hash-viejo', entradaConRepo('nuevo', ['rust']));
    assert.equal(res.estado, 'conflicto');
  });
  it('sin cambios → ok, cambia false y el fichero intacto', () => {
    const r = raizTmp();
    const antes = readFileSync(join(r, NOMBRE_PLANTILLA), 'utf8');
    const res = guardarEdicionPlantilla(r, hashActual(r), JSON.parse(TEXTO_REAL));
    assert.equal(res.estado, 'ok');
    if (res.estado === 'ok') {
      assert.equal(res.cambia, false);
      assert.equal(res.diff, null);
    }
    assert.equal(readFileSync(join(r, NOMBRE_PLANTILLA), 'utf8'), antes);
  });
  it('vista previa: el diff empieza en la línea de la última entrada de stackDeProyecto', () => {
    const r = raizTmp();
    const res = calcularEdicionPlantilla(r, hashActual(r), entradaConRepo('nuevo-repo', ['rust']));
    assert.equal(res.estado, 'ok');
    if (res.estado !== 'ok') return;
    assert.equal(res.cambia, true);
    /* «trabajos cliente/uno dos» es la última clave (línea 17): la nueva entrada
     * gana la coma y una línea. */
    assert.equal(res.diff?.desde, 17);
    assert.equal(res.diff?.poner.length, 2);
    assert.equal(readFileSync(join(r, NOMBRE_PLANTILLA), 'utf8'), TEXTO_REAL, 'la vista previa no escribe');
  });
  it('escribe el cambio y el hash devuelto coincide con el fichero', () => {
    const r = raizTmp();
    const res = guardarEdicionPlantilla(r, hashActual(r), entradaConRepo('nuevo-repo', ['rust']));
    assert.equal(res.estado, 'ok');
    if (res.estado !== 'ok') return;
    const leido = readFileSync(join(r, NOMBRE_PLANTILLA), 'utf8');
    assert.ok(leido.includes('"nuevo-repo": ["rust"]'));
    assert.equal(res.hash, hashDe(leido));
    assert.equal(hashActual(r), res.hash);
  });
  it('entrada inválida → error y el fichero intacto', () => {
    const r = raizTmp();
    const antes = readFileSync(join(r, NOMBRE_PLANTILLA), 'utf8');
    const res = guardarEdicionPlantilla(r, hashActual(r), entradaConRepo('mi-app', ['go']));
    assert.equal(res.estado, 'error');
    assert.equal(readFileSync(join(r, NOMBRE_PLANTILLA), 'utf8'), antes);
  });
  it('fichero cambiado después de leer → conflicto, sin pisar', () => {
    const r = raizTmp();
    const previo = hashActual(r);
    writeFileSync(join(r, NOMBRE_PLANTILLA), TEXTO_REAL.replace('"app-dos": ["ts"]', '"app-dos": []'), 'utf8');
    const res = guardarEdicionPlantilla(r, previo, entradaConRepo('nuevo-repo', ['rust']));
    assert.equal(res.estado, 'conflicto');
    assert.ok(readFileSync(join(r, NOMBRE_PLANTILLA), 'utf8').includes('"app-dos": []'));
  });
});
