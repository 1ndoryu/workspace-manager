/* Proveedor de reglas VIVAS del gate desde el runtime de sentinel en uso
 * (checkout compartido del área; instaladas en AppData como respaldo).
 * [por que] El catálogo de reglas vivía en src/shared/gate/catalogo/reglas.ts como un
 * snapshot congelado de la versión fijada (0.7.4): al subir sentinel quedaba
 * viejo. El runtime expone el catálogo en tiempo de ejecución
 * (`out/config/ruleRegistry.js`: `obtenerTodasLasReglas()` + `REGISTRO`), así
 * que este proveedor lee el runtime en uso y sirve las reglas reales por
 * API. Si el runtime no está, la versión cambió y no hay esquema emparejado, o
 * el import del módulo falla -> cae al catálogo estático embebido y lo reporta
 * (fuente: 'estatica'), nunca rompe el árbol por ausencia de runtime.
 * Resolución server-side: el cliente es 'tonto' y solo pide /gate/reglas.
 * La resolución de CLI (disco) vive en proveedor/cli.ts y las funciones puras en
 * proveedor/puro.ts; aquí se reexportan para que los importadores no cambien. */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReglaCatalogo } from '../../../shared/gate/catalogo/reglas.js';
import { REGLAS as REGLAS_ESTATICAS } from '../../../shared/gate/catalogo/reglas.js';
import type { NodoEsquema } from '../../../shared/gate/modelo/esquema.js';
import type { MetadatosGate, TipoGate } from '../../../shared/gate/proveedores.js';
import { proveedorDe, registrarProveedor } from '../../../shared/gate/proveedores.js';
import { ESQUEMA_SENTINEL } from '../../../shared/gate/catalogo/sentinel.js';
import { ESQUEMA_VARSENSE } from '../../../shared/gate/catalogo/varsense.js';
import { serializarEsquema } from '../../../shared/gate/modelo/serial.js';
import { RAIZ_QUALITY_TOOLS } from '../../plataforma/rutas.js';
import { raizVersiones, checkoutSentinel } from './proveedor/cli.js';
import { esPrerelease, normalizar, semverSort } from './proveedor/puro.js';

export { raizVersiones, baseSentinel, checkoutSentinel, provisionPathSentinel, cliSentinelParaProyecto } from './proveedor/cli.js';
export type { ResolucionCli } from './proveedor/cli.js';

/* IMPORTANTE: el ruleRegistry es un módulo CommonJS de node_modules del
 * runtime. createRequire permite cargarlo con `require` desde un archivo .mjs
 * del build, sin cache compartida con el app. Se cachea por versión+mtime. */
const require = createRequire(import.meta.url);

interface CacheReglas {
  version: string;
  fuente: 'runtime' | 'estatica';
  escaneadoEn: Date;
  mtime: number;
  catalogo: ReglaCatalogo[];
}

let cache: CacheReglas | null = null;

/* Devuelve la version instalada mas alta estable (o null si no hay runtime). */
export function versionRuntime(): string | null {
  try {
    if (!existsSync(raizVersiones())) return null;
    const versiones = readdirSync(raizVersiones())
      .filter((v) => !esPrerelease(v) && /^\d+(\.\d+)*$/.test(v))
      .sort(semverSort);
    return versiones[versiones.length - 1] ?? null;
  } catch {
    return null;
  }
}

/* Versión REALMENTE en uso: la del checkout compartido si está provisionado
 * (es la que ejecuta el gate y la que fijan los consumidores), y si no, la
 * instalada más alta. [por que] Un conteo sin la versión del binario que lo
 * produjo no acredita un cierre (regla de la campaña 039A-1 §5.5): la UI y la
 * clave de frescura tienen que reportar la MISMA versión que mide. */
export function versionSentinel(): string | null {
  const base = checkoutSentinel();
  if (base) {
    try {
      const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { version?: unknown };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      /* checkout ilegible: cae a las versiones instaladas */
    }
  }
  return versionRuntime();
}

/* Carga el catalogo VIVO del runtime instalado. Fallback al estatico embebido
 * si falla cualquier paso (sin runtime, import roto, forma inesperada). */
function cargarVivo(rutaOut: string): ReglaCatalogo[] | null {
  try {
    const api = require(join(rutaOut, 'config', 'ruleRegistry.js')) as {
      obtenerTodasLasReglas?: () => Array<Record<string, unknown>>;
    };
    const reglas = api.obtenerTodasLasReglas?.();
    if (!Array.isArray(reglas) || reglas.length === 0) return null;
    return reglas.map((r) => normalizar(r, true));
  } catch {
    return null;
  }
}

/* Localiza la ruta `out` del runtime en uso y su mtime de ruleRegistry.js.
 * Se prueban los candidatos en orden de prioridad (checkout compartido antes
 * que las versiones instaladas) para que el catálogo de reglas y el esquema
 * provengan del MISMO artefacto que ejecuta el análisis. */
function localizarOut(): { ruta: string; mtime: number } | null {
  const candidatas: string[] = [];
  const base = checkoutSentinel();
  if (base) candidatas.push(join(base, 'out'));
  const version = versionRuntime();
  if (version) candidatas.push(join(raizVersiones(), version, 'out'));
  for (const rutaOut of candidatas) {
    const archivo = join(rutaOut, 'config', 'ruleRegistry.js');
    if (!existsSync(archivo)) continue;
    try {
      return { ruta: rutaOut, mtime: statSync(archivo).mtimeMs };
    } catch {
      /* candidato ilegible: se prueba el siguiente */
    }
  }
  return null;
}

/* Version de referencia de la curacion actual del esquema sentinel: es la
 * version del runtime EN USO (checkout compartido del area, 0.7.15) contra la
 * que se verifico `ESQUEMA_SENTINEL`. [por que] 2026-09-10: antes decia 0.7.4
 * (la unica instalada en %LOCALAPPDATA%) mientras el gate de los proyectos ya
 * fijaba 0.7.8, asi que el panel reportaba un drift inexistente y comparaba
 * contra el esquema de una version que no se ejecuta. `sync:gate` la valida
 * contra el `config.d.ts` del mismo runtime (2026-09-28: 0 problemas contra
 * 0.7.15, exit 0); si el runtime vuelve a subir, se revisa la curacion y se
 * actualiza aqui. Exportada para que el script de sync (E2) compare contra la
 * MISMA fuente de verdad. NO es condicion de ejecucion: `cliSentinelParaProyecto`
 * resuelve por el pin del manifest de cada proyecto. */
export const VERSION_CURACION_SENTINEL = '0.7.19';

/* Catalogo de reglas del gate: vive en el runtime si esta disponible, con
 * cache por version+mtime. Devuelve tambien la version y la fuente para que
 * la UI pueda mostrar "reglas del runtime 0.7.4" vs "estaticas". */
export function reglasGate(): {
  version: string;
  fuente: 'runtime' | 'estatica';
  reglas: ReglaCatalogo[];
} {
  const out = localizarOut();
  if (!out) {
    if (!cache || cache.fuente !== 'estatica') {
      cache = {
        version: '—',
        fuente: 'estatica',
        escaneadoEn: new Date(),
        mtime: 0,
        catalogo: REGLAS_ESTATICAS,
      };
    }
    return { version: cache.version, fuente: cache.fuente, reglas: cache.catalogo };
  }
  /* Cache por mtime: solo recarga si el ruleRegistry cambio en disco. */
  if (cache && cache.fuente === 'runtime' && cache.mtime === out.mtime) {
    return { version: cache.version, fuente: cache.fuente, reglas: cache.catalogo };
  }
  const vivas = cargarVivo(out.ruta);
  if (vivas) {
    cache = {
      version: versionSentinel() ?? '—',
      fuente: 'runtime',
      escaneadoEn: new Date(),
      mtime: out.mtime,
      catalogo: vivas,
    };
    return { version: cache.version, fuente: cache.fuente, reglas: cache.catalogo };
  }
  /* Runtime presente pero fallo la carga: estadico embebido + observar (no
   * romper). [por que] El fallback tolerante a fallos del plan: si el import
   * del modulo falla, se usa el catalogo estatico y se reporta. */
  if (!cache || cache.fuente !== 'estatica') {
    cache = {
      version: versionSentinel() ?? '—',
      fuente: 'estatica',
      escaneadoEn: new Date(),
      mtime: 0,
      catalogo: REGLAS_ESTATICAS,
    };
  }
  return { version: cache.version, fuente: cache.fuente, reglas: cache.catalogo };
}

/* Proveedores concretos del gate, registrados server-side (el cliente solo
 * consulta por API). [por que] `ProveedorGate` es la unica puerta del editor:
 * sentinel resuelve esquema curado + reglas vivas del runtime; varsense desde
 * la fase G reporta su runtime REAL del checkout compartido (fuente runtime,
 * no estatica) aunque su catalogo de reglas siga vacio (las reglas viven en
 * el binario, no en un catalogo consultable). Anadir tool = registrar aqui;
 * el editor no cambia (E1). */
registrarProveedor({
  tipo: 'sentinel',
  esquema: (): NodoEsquema => ESQUEMA_SENTINEL(),
  reglas: (): ReglaCatalogo[] => reglasGate().reglas,
  versionReferencia: (): string => VERSION_CURACION_SENTINEL,
  /* Runtime realmente en uso (checkout compartido > instaladas): es la version
   * con la que se mide y la que debe reportar la UI. */
  runtimeInstalado: (): string | null => versionSentinel(),
  fuente: (): 'runtime' | 'estatica' => reglasGate().fuente,
});
/* Version real de varsense del checkout compartido (misma resolucion que
 * `entornoGate` del analizador: env override gana, sino <area>/.quality-tools/
 * varsense). null si no esta provisionado. */
export function versionVarsense(entorno: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const base = entorno.GLORY_VARSENSE_SOURCE_PATH || join(RAIZ_QUALITY_TOOLS, 'varsense');
    const pkg = join(base, 'package.json');
    if (!existsSync(pkg)) return null;
    const data = JSON.parse(readFileSync(pkg, 'utf8')) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

registrarProveedor({
  tipo: 'varsense',
  esquema: (): NodoEsquema => ESQUEMA_VARSENSE(),
  /* [por que] varsense no declara `reglas` ni `versionReferencia`: no tiene
   * catalogo de reglas propio ni version de curación del esquema. Antes los
   * cumplia con degenerados (`[]` y `'—'`), y eso obligaba al cliente a
   * ramificar por tipo para no pintar un catalogo vacio. Un proveedor que no
   * las tiene, no las declara (ver ProveedorGate). */
  runtimeInstalado: (): string | null => versionVarsense(),
  fuente: (): 'runtime' | 'estatica' => (versionVarsense() ? 'runtime' : 'estatica'),
});

/* Esquema + reglas + metadata de una herramienta, como la sirve la API
 * `/gate/dinamico`. Devuelve el esquema SERIALIZADO (con ciclos resueltos a
 * refs) y nunca toca el JSON real de ningun proyecto. */
export function esquemaGate(
  tool: TipoGate,
): { metadatos: MetadatosGate; esquemaText: string; totalReglas: number; reglas: ReglaCatalogo[] } | null {
  const prov = proveedorDe(tool);
  if (!prov) return null;
  /* [por que] El proveedor es la unica autoridad sobre sus reglas: si no las
   * declara, son cero. Devolverlas aqui es lo que permite al cliente pintarlas
   * sin preguntar de que herramienta se trata (antes ramificaba por tipo). */
  const reglas = prov.reglas?.() ?? [];
  return {
    metadatos: {
      tipo: prov.tipo,
      versionReferencia: prov.versionReferencia?.() ?? null,
      runtimeInstalado: prov.runtimeInstalado(),
      fuente: prov.fuente(),
    },
    esquemaText: serializarEsquema(prov.esquema()),
    totalReglas: reglas.length,
    reglas,
  };
}
