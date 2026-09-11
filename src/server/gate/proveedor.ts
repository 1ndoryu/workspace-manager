/* Proveedor de reglas VIVAS del gate desde el runtime de sentinel en uso
 * (checkout compartido del área; instaladas en AppData como respaldo).
 * [por que] El catálogo de reglas vivía en src/shared/gate/reglas.ts como un
 * snapshot congelado de la versión fijada (0.7.4): al subir sentinel quedaba
 * viejo. El runtime expone el catálogo en tiempo de ejecución
 * (`out/config/ruleRegistry.js`: `obtenerTodasLasReglas()` + `REGISTRO`), así
 * que este proveedor lee el runtime en uso y sirve las reglas reales por
 * API. Si el runtime no está, la versión cambió y no hay esquema emparejado, o
 * el import del módulo falla -> cae al catálogo estático embebido y lo reporta
 * (fuente: 'estatica'), nunca rompe el árbol por ausencia de runtime.
 * Resolución server-side: el cliente es 'tonto' y solo pide /gate/reglas. */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ReglaCatalogo, SeveridadRegla } from '../../shared/gate/reglas.js';
import { REGLAS as REGLAS_ESTATICAS } from '../../shared/gate/reglas.js';
import type { NodoEsquema } from '../../shared/gate/esquema.js';
import type { MetadatosGate, TipoGate } from '../../shared/gate/proveedores.js';
import { proveedorDe, registrarProveedor } from '../../shared/gate/proveedores.js';
import { ESQUEMA_SENTINEL } from '../../shared/gate/sentinel.js';
import { ESQUEMA_VARSENSE } from '../../shared/gate/varsense.js';
import { serializarEsquema } from '../../shared/gate/serial.js';

/* Raíz de las versiones instaladas de GlorySentinel (AppData local). */
export const RAIZ_VERSIONS = join(
  process.env.LOCALAPPDATA || join(process.env.APPDATA || '', '..'),
  'GlorySentinel',
  'versions',
);

/* Raíz del área (misma fuente que el resto del server; `WS_AREA_ROOT` gana). */
const RAIZ_AREA = process.env.WS_AREA_ROOT || 'C:/Users/Owner/OneDrive/Documentos/area-trabajo';

/* Checkout COMPARTIDO de Sentinel (<área>/.quality-tools/sentinel): el mismo
 * artefacto que ejecuta el gate de los proyectos (`quality-tools.json` →
 * `provisionPath`). [por que] 2026-09-10: el análisis de la consola resolvía el
 * runtime SOLO por las versiones instaladas en `%LOCALAPPDATA%\GlorySentinel\
 * versions` —donde la más alta era 0.7.4, congelada desde agosto— mientras los
 * proyectos fijan 0.7.8 en el checkout compartido. El panel medía con una
 * herramienta DISTINTA a la del gate, así que sus cifras no eran comparables
 * con las de ningún plan (PROYECTO TASKS salía con 0 errores donde el gate
 * daba 17, porque `expect-produccion-rs` no existe en 0.7.4). VarSense ya
 * resolvía desde el checkout compartido (fase G); esto elimina la asimetría.
 * El override por env gana y, si no hay checkout provisionado, se cae a las
 * versiones instaladas (nunca se rompe el árbol por ausencia de runtime). */
export function checkoutSentinel(): string | null {
  const base = process.env.GLORY_SENTINEL_SOURCE_PATH || join(RAIZ_AREA, '.quality-tools', 'sentinel');
  return existsSync(join(base, 'out', 'cli', 'index.js')) ? base : null;
}

/* Resolución del CLI por PROYECTO desde su `quality-tools.json`: si declara
 * un `provisionPath` propio para sentinel (p.ej. glory-harness →
 * `../.quality-tools-harness/sentinel`), ESE es el artefacto que ejecuta su
 * gate canónico y la consola debe medir con él, no con el checkout
 * compartido. [por que] 039A-4 (2026-09-10): el compartido estaba en 902c45e
 * mientras glory-harness fija 1587c59 (dos días más nuevo, con
 * unwrap-produccion-rs y axum-ruta-sintaxis-rs ya corregidos): la consola le
 * contaba 49 errores inexistentes que su gate no ve. Solo se acepta si está
 * provisionado (existe el entry del CLI) y su versión coincide con
 * VERSION_CURACION_SENTINEL; si no, null y el llamador cae al compartido
 * (nunca se rompe el árbol por un manifest ajeno). */
export interface ResolucionCli {
  base: string;
  cli: string;
  version: string;
  commit: string | null;
}
export function cliSentinelParaProyecto(rutaProyecto: string): ResolucionCli | null {
  try {
    const manifest = JSON.parse(readFileSync(join(rutaProyecto, 'quality-tools.json'), 'utf8')) as {
      tools?: { sentinel?: { provisionPath?: unknown; cli?: unknown; commit?: unknown } };
    };
    const decl = manifest.tools?.sentinel;
    if (typeof decl?.provisionPath !== 'string' || !decl.provisionPath) return null;
    const base = resolve(rutaProyecto, decl.provisionPath);
    const entry = typeof decl.cli === 'string' && decl.cli ? decl.cli : join('out', 'cli', 'index.js');
    const cli = join(base, entry);
    if (!existsSync(cli)) return null;
    const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { version?: unknown };
    if (typeof pkg.version !== 'string' || pkg.version !== VERSION_CURACION_SENTINEL) return null;
    return {
      base,
      cli,
      version: pkg.version,
      commit: typeof decl.commit === 'string' ? decl.commit.slice(0, 7) : null,
    };
  } catch {
    return null;
  }
}

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

/* Versión semver comparada por partes numericas. [por que] Al elegir entre
 * varias versiones instaladas se prefiere la mas alta ESTABLE (sin sufijo
 * -alpha/-beta). La regla del proyecto es la version fijada; si no hay lock
 * que la fije, la mas alta estable es la fuente de verdad. */
function semverSort(a: string, b: string): number {
  const pa = a.split(/[.\-]/).map(Number);
  const pb = b.split(/[.\-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function esPrerelease(v: string): boolean {
  return /-(alpha|beta|rc|next|dev|pre)/i.test(v);
}

/* Devuelve la version instalada mas alta estable (o null si no hay runtime). */
export function versionRuntime(): string | null {
  try {
    if (!existsSync(RAIZ_VERSIONS)) return null;
    const versiones = readdirSync(RAIZ_VERSIONS)
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

/* Mapea la categoria (string) del runtime a id legible conocido o el propio.
 * [por que] obtenerTodasLasReglas() devuelve `categoria` como string; los ids
 * coinciden con CATEGORIAS_REGLAS, pero se normaliza por si el runtime los
 * cambia, sin hardcodear la lista en el proveedor. */
function normalizar(regla: Record<string, unknown>, habilitadaDefault: boolean): ReglaCatalogo {
  const severidad = String(regla.severidad ?? regla.severidadDefault ?? 'warning') as SeveridadRegla;
  return {
    id: String(regla.id),
    nombre: String(regla.nombre ?? regla.id),
    categoria: String(regla.categoria ?? 'general'),
    habilitada: typeof regla.habilitada === 'boolean'
      ? regla.habilitada
      : habilitadaDefault,
    severidad,
  };
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
  if (version) candidatas.push(join(RAIZ_VERSIONS, version, 'out'));
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
 * version del runtime EN USO (checkout compartido del area, 0.7.8) contra la
 * que se verifico `ESQUEMA_SENTINEL`. [por que] 2026-09-10: antes decia 0.7.4
 * (la unica instalada en %LOCALAPPDATA%) mientras el gate de los proyectos ya
 * fijaba 0.7.8, asi que el panel reportaba un drift inexistente y comparaba
 * contra el esquema de una version que no se ejecuta. `sync:gate` la valida
 * contra el `config.d.ts` del mismo runtime; si el runtime vuelve a subir, se
 * revisa la curacion y se actualiza aqui. Exportada para que el script de sync
 * (E2) compare contra la MISMA fuente de verdad. */
export const VERSION_CURACION_SENTINEL = '0.7.8';

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
export function versionVarsense(): string | null {
  try {
    const base = process.env.GLORY_VARSENSE_SOURCE_PATH || join(RAIZ_AREA, '.quality-tools', 'varsense');
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
  reglas: (): ReglaCatalogo[] => [],
  versionReferencia: (): string => '—',
  runtimeInstalado: (): string | null => versionVarsense(),
  fuente: (): 'runtime' | 'estatica' => (versionVarsense() ? 'runtime' : 'estatica'),
});

/* Esquema + reglas + metadata de una herramienta, como la sirve la API
 * `/gate/dinamico`. Devuelve el esquema SERIALIZADO (con ciclos resueltos a
 * refs) y nunca toca el JSON real de ningun proyecto. */
export function esquemaGate(
  tool: TipoGate,
): { metadatos: MetadatosGate; esquemaText: string; totalReglas: number } | null {
  const prov = proveedorDe(tool);
  if (!prov) return null;
  const reglas = prov.reglas();
  return {
    metadatos: {
      tipo: prov.tipo,
      versionReferencia: prov.versionReferencia(),
      runtimeInstalado: prov.runtimeInstalado(),
      fuente: prov.fuente(),
    },
    esquemaText: serializarEsquema(prov.esquema()),
    totalReglas: reglas.length,
  };
}
