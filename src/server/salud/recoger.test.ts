/* [17AA-5] El registro privado se lee del repo, no de la raíz del área.
 *
 * `recogerArea` recibía `raizArea` y lo usaba para resolver la config privada,
 * de modo que buscaba `<área>/config/registro.json` —que no existe— en vez de
 * `<repo>/config/registro.json`. Con `registro` a null, `noAplica` salía vacío
 * y el tablero reportaba como «sin registrar» todo repo declarado ahí
 * (borrador, entre otros). El par de casos de abajo fija las dos mitades:
 * la raíz del área NO es fuente de config, y la config privada del entorno SÍ lo es.
 * [por que] El entorno llega inyectado: los casos no leen variables ni el HOME real. */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recogerArea } from './recoger.js';
import type { Entorno } from './entorno.js';

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

/* Entorno falso: todo apunta a carpetas temporales vacías salvo la config privada,
 * que es la única ruta que los casos necesitan. */
function entornoFalso(configPrivada: string): Entorno {
  const vacia = temporal();
  return {
    plataforma: 'linux',
    homedir: vacia,
    raizRepo: vacia,
    raizTemporales: temporal(),
    carpetaSkills: vacia,
    rutaConfigPrivada: (nombre) => join(configPrivada, nombre),
    localAppData: undefined,
    cargoIncremental: undefined,
  };
}

afterEach(() => {
  while (temporales.length > 0) rmSync(temporales.pop()!, { recursive: true, force: true });
});

describe('recogerArea · origen del registro privado', () => {
  it('no lee el registro de la raíz del área', async () => {
    const raiz = areaFalsa({ noAplica: { 'un-repo': 'sin-mando-intencional' } });

    const datos = await recogerArea([], raiz, null, Date.now(), entornoFalso(temporal()));

    /* Testigo: el barrido sí ve el repo. Si no, la aserción de abajo pasaría
     * por no haber mirado, no por leer el registro correcto. */
    assert.ok(datos.carpetasGit.includes('un-repo'), 'el barrido tiene que detectar el repo');
    assert.ok(
      !datos.registradas.includes('un-repo'),
      'la raíz del área no es fuente de config: `noAplica` de <área>/config no debe contar',
    );
  });

  it('sí lee el registro de la config privada del entorno', async () => {
    const config = temporal();
    writeFileSync(
      join(config, 'registro.json'),
      JSON.stringify({ proyectos: [{ id: 'declarado' }], noAplica: { 'otro-repo': 'sin-mando-intencional' } }),
      'utf8',
    );
    const raiz = areaFalsa(null);

    const datos = await recogerArea([], raiz, null, Date.now(), entornoFalso(config));

    assert.ok(datos.registradas.includes('declarado'), 'los proyectos del registro privado cuentan');
    assert.ok(datos.registradas.includes('otro-repo'), 'las entradas de noAplica del registro privado cuentan');
  });
});
