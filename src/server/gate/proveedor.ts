/* Proveedor de reglas VIVAS del gate desde el runtime de sentinel instalado.
 * [por que] El catálogo de reglas vivía en src/shared/gate/reglas.ts como un
 * snapshot congelado de la versión fijada (0.7.4): al subir sentinel quedaba
 * viejo. El runtime expone el catálogo en tiempo de ejecución
 * (`out/config/ruleRegistry.js`: `obtenerTodasLasReglas()` + `REGISTRO`), así
 * que este proveedor lee el runtime instalado y sirve las reglas reales por
 * API. Si el runtime no está, la versión cambió y no hay esquema emparejado, o
 * el import del módulo falla -> cae al catálogo estático embebido y lo reporta
 * (fuente: 'estatica'), nunca rompe el árbol por ausencia de runtime.
 * Resolución server-side: el cliente es 'tonto' y solo pide /gate/reglas. */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReglaCatalogo, SeveridadRegla } from '../../shared/gate/reglas.js';
import { REGLAS as REGLAS_ESTATICAS } from '../../shared/gate/reglas.js';

/* Raíz de las versiones instaladas de GlorySentinel (AppData local). */
export const RAIZ_VERSIONS = join(
  process.env.LOCALAPPDATA || join(process.env.APPDATA || '', '..'),
  'GlorySentinel',
  'versions',
);

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

/* Localiza la ruta `out` del runtime elegido y su mtime de ruleRegistry.js. */
function localizarOut(): { ruta: string; mtime: number } | null {
  const version = versionRuntime();
  if (!version) return null;
  const rutaOut = join(RAIZ_VERSIONS, version, 'out');
  const archivo = join(rutaOut, 'config', 'ruleRegistry.js');
  if (!existsSync(archivo)) return null;
  try {
    return { ruta: rutaOut, mtime: statSync(archivo).mtimeMs };
  } catch {
    return null;
  }
}

/* Catalogo de reglas del gate: vive en el runtime si esta disponible, con
 * cache por version+mtime. Devuelve tambien la version y la fuente para que
 * la UI pueda mostrar "reglas del runtime 0.7.4" vs "estaticas". */
export function reglasGate(): { version: string; fuente: 'runtime' | 'estatica'; reglas: ReglaCatalogo[] } {
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
      version: versionRuntime() ?? '—',
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
      version: versionRuntime() ?? '—',
      fuente: 'estatica',
      escaneadoEn: new Date(),
      mtime: 0,
      catalogo: REGLAS_ESTATICAS,
    };
  }
  return { version: cache.version, fuente: cache.fuente, reglas: cache.catalogo };
}
