/* Resolución del CLI de GlorySentinel: la raíz de las versiones instaladas, el checkout
 * compartido del área y el checkout que cada proyecto declara en su `quality-tools.json`.
 * Solo lee disco (existsSync/readFileSync); la lógica de reglas y esquemas vive en proveedor.ts.
 * [por que] Separado de proveedor.ts (gate limite-lineas); proveedor.ts lo reexporta. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RAIZ_QUALITY_TOOLS } from '../../../plataforma/rutas.js';

/* Raíz de las versiones instaladas de GlorySentinel (AppData local). [por que] Función
 * con el entorno como parámetro (no constante al cargar el módulo): así se prueba con
 * un entorno falso y el valor sale de quien llama, no de un global. */
export function raizVersiones(entorno: NodeJS.ProcessEnv = process.env): string {
  return join(entorno.LOCALAPPDATA || join(entorno.APPDATA || '', '..'), 'GlorySentinel', 'versions');
}

/* Checkout COMPARTIDO de Sentinel (<área>/.quality-tools/sentinel): el mismo
 * artefacto que ejecuta el gate de los proyectos (`quality-tools.json` →
 * `provisionPath`). [por que] 2026-09-10: el análisis de la consola resolvía el
 * runtime SOLO por las versiones instaladas en `%LOCALAPPDATA%\GlorySentinel\
 * versions` —donde la más alta era 0.7.4, congelada desde agosto— mientras los
 * proyectos fijan 0.7.8 en el checkout compartido. El panel medía con una
 * herramienta DISTINTA a la del gate, así que sus cifras no eran comparables
 * con las de ningún plan (proyecto-ejemplo salía con 0 errores donde el gate
 * daba 17, porque `expect-produccion-rs` no existe en 0.7.4). VarSense ya
 * resolvía desde el checkout compartido (fase G); esto elimina la asimetría.
 * El override por env gana y, si no hay checkout provisionado, se cae a las
 * versiones instaladas (nunca se rompe el árbol por ausencia de runtime). */
export function baseSentinel(entorno: NodeJS.ProcessEnv = process.env): string {
  return entorno.GLORY_SENTINEL_SOURCE_PATH || join(RAIZ_QUALITY_TOOLS, 'sentinel');
}
export function checkoutSentinel(entorno: NodeJS.ProcessEnv = process.env): string | null {
  const base = baseSentinel(entorno);
  return existsSync(join(base, 'out', 'cli', 'index.js')) ? base : null;
}

/* Carpeta del checkout que el manifest del proyecto declara (`provisionPath`) y el
 * pin de versión, si lo hay. null si el proyecto no declara checkout propio.
 * [por que] Lo usan la resolución local (cliSentinelParaProyecto) y la remota
 * (fuentesSentinel): las dos deben apuntar al mismo checkout del proyecto. */
export function provisionPathSentinel(rutaProyecto: string): { ruta: string; pin: string | null } | null {
  try {
    const manifest = JSON.parse(readFileSync(join(rutaProyecto, 'quality-tools.json'), 'utf8')) as {
      tools?: { sentinel?: { provisionPath?: unknown; version?: unknown } };
    };
    const decl = manifest.tools?.sentinel;
    if (typeof decl?.provisionPath !== 'string' || !decl.provisionPath) return null;
    return {
      ruta: resolve(rutaProyecto, decl.provisionPath),
      pin: typeof decl.version === 'string' && decl.version ? decl.version : null,
    };
  } catch {
    return null;
  }
}

/* Resolución del CLI por PROYECTO desde su `quality-tools.json`: si declara
 * un `provisionPath` propio para sentinel (p.ej. proyecto-ejemplo →
 * `../.quality-tools-harness/sentinel`), ESE es el artefacto que ejecuta su
 * gate canónico y la consola debe medir con él, no con el checkout
 * compartido. [por que] 039A-4 (2026-09-10): el compartido estaba en 902c45e
 * mientras proyecto-ejemplo fija 1587c59 (dos días más nuevo, con
 * unwrap-produccion-rs y axum-ruta-sintaxis-rs ya corregidos): la consola le
 * contaba 49 errores inexistentes que su gate no ve. Solo se acepta si está
 * provisionado (existe el entry del CLI) y su versión coincide con la
 * declarada en su propio manifest; si no, null y el llamador cae al
 * compartido (nunca se rompe el árbol por un manifest ajeno). [por que]
 * 2026-09-28: la condición anterior exigía ADEMÁS que la versión coincidiera
 * con VERSION_CURACION_SENTINEL (0.7.8→0.7.15), así que cualquier pin propio
 * (harness 0.7.12@66a2113) se rechazaba y la consola lo medía con el
 * compartido 0.7.15 —un binario que no es el de su gate—. La curación es la
 * versión contra la que se verificó el ESQUEMA (sync:gate), no una condición
 * de ejecución: aquí manda el pin del manifest. */
export interface ResolucionCli {
  base: string;
  cli: string;
  version: string;
  commit: string | null;
}
export function cliSentinelParaProyecto(rutaProyecto: string): ResolucionCli | null {
  try {
    const manifest = JSON.parse(readFileSync(join(rutaProyecto, 'quality-tools.json'), 'utf8')) as {
      tools?: { sentinel?: { provisionPath?: unknown; cli?: unknown; commit?: unknown; version?: unknown } };
    };
    const decl = manifest.tools?.sentinel;
    if (typeof decl?.provisionPath !== 'string' || !decl.provisionPath) return null;
    const base = resolve(rutaProyecto, decl.provisionPath);
    const entry = typeof decl.cli === 'string' && decl.cli ? decl.cli : join('out', 'cli', 'index.js');
    const cli = join(base, entry);
    if (!existsSync(cli)) return null;
    const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { version?: unknown };
    if (typeof pkg.version !== 'string') return null;
    /* El pin del manifest manda: si declara versión y el checkout trae otra,
     * ese checkout no es el artefacto fijado (p.ej. manifest stale) y se
     * rechaza para que el llamador caiga al compartido. */
    if (typeof decl.version === 'string' && decl.version && decl.version !== pkg.version) return null;
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
