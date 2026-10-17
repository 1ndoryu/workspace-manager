/* [17AA-5] El registro privado se lee del repo, no de la raíz del área.
 *
 * `recogerArea` recibía `raizArea` y lo usaba para resolver la config privada,
 * de modo que buscaba `<área>/config/registro.json` —que no existe— en vez de
 * `<repo>/config/registro.json`. Con `registro` a null, `noAplica` salía vacío
 * y el tablero reportaba como «sin registrar» todo repo declarado ahí
 * (borrador, entre otros). El par de casos de abajo fija las dos mitades:
 * la raíz del área NO es fuente de config, y `WS_CONFIG_ROOT` SÍ lo es. */
import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recogerArea } from './recoger.js';

const temporales: string[] = [];

function temporal(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wm-recoger-'));
  temporales.push(dir);
  return dir;
}

/* Un área mínima con un repo y, si se pide, su propio config/registro.json. */
function areaFalsa(registroEnArea: unknown | null): string {
  const raiz = temporal();
  mkdirSync(join(raiz, 'un-repo', '.git'), { recursive: true });
  if (registroEnArea !== null) {
    mkdirSync(join(raiz, 'config'), { recursive: true });
    writeFileSync(join(raiz, 'config', 'registro.json'), JSON.stringify(registroEnArea), 'utf8');
  }
  return raiz;
}

const originalConfig = process.env.WS_CONFIG_ROOT;
const originalTmp = process.env.WM_TMP;
/* `recogerArea` mide el tamaño de la raíz de temporales: sin apuntarla a un
 * directorio vacío, cada caso recorre `C:\tmp` entero (17 s medidos). */
const tmpVacio = mkdtempSync(join(tmpdir(), 'wm-recoger-tmp-'));
process.env.WM_TMP = tmpVacio;

afterEach(() => {
  if (originalConfig === undefined) delete process.env.WS_CONFIG_ROOT;
  else process.env.WS_CONFIG_ROOT = originalConfig;
  while (temporales.length > 0) rmSync(temporales.pop()!, { recursive: true, force: true });
});

after(() => {
  if (originalTmp === undefined) delete process.env.WM_TMP;
  else process.env.WM_TMP = originalTmp;
  rmSync(tmpVacio, { recursive: true, force: true });
});

describe('recogerArea · origen del registro privado', () => {
  it('no lee el registro de la raíz del área', async () => {
    delete process.env.WS_CONFIG_ROOT;
    const raiz = areaFalsa({ noAplica: { 'un-repo': 'sin-mando-intencional' } });

    const datos = await recogerArea([], raiz, null, Date.now());

    /* Testigo: el barrido sí ve el repo. Si no, la aserción de abajo pasaría
     * por no haber mirado, no por leer el registro correcto. */
    assert.ok(datos.carpetasGit.includes('un-repo'), 'el barrido tiene que detectar el repo');
    assert.ok(
      !datos.registradas.includes('un-repo'),
      'la raíz del área no es fuente de config: `noAplica` de <área>/config no debe contar',
    );
  });

  it('sí lee el registro de la config privada', async () => {
    const config = temporal();
    writeFileSync(
      join(config, 'registro.json'),
      JSON.stringify({ proyectos: [{ id: 'declarado' }], noAplica: { 'otro-repo': 'sin-mando-intencional' } }),
      'utf8',
    );
    process.env.WS_CONFIG_ROOT = config;
    const raiz = areaFalsa(null);

    const datos = await recogerArea([], raiz, null, Date.now());

    assert.ok(datos.registradas.includes('declarado'), 'los proyectos del registro privado cuentan');
    assert.ok(datos.registradas.includes('otro-repo'), 'las entradas de noAplica del registro privado cuentan');
  });
});
