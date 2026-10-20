/* Lectura de git y de la configuracion de quality:sync (E/S): HEAD, suciedad, manifests
 * de consumidores y la comparacion del pin contra su checkout. Lo puro vive en quality-sync-puro.mjs. */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { rutaConfigPrivada } from './shared/rutas.mjs';
import { BIN_GIT } from './shared/binarios.mjs';
import { QITOOLS, corto, esCompartido } from './quality-sync-puro.mjs';

/* Consumidores del gate: QUE proyectos del area reciben el pin. [por que] Es
 * configuracion nuestra, no del producto: la lista de nuestros proyectos no
 * puede ir en el repo que se publica. Vive en la config privada
 * (`config/quality-consumidores.json`), con ejemplo versionado. Sin ella el
 * script no falla: informa de que no hay consumidores declarados y sale en
 * verde, porque un clone recien hecho no tiene ninguno que validar. */
export function leerConsumidores() {
  const ruta = rutaConfigPrivada('quality-consumidores.json');
  if (!existsSync(ruta)) return null;
  const data = JSON.parse(readFileSync(ruta, 'utf8'));
  const lista = Array.isArray(data?.consumidores) ? data.consumidores : null;
  if (!lista) throw new Error(`'quality-consumidores.json' sin array 'consumidores' en ${ruta}`);
  /* Normaliza la ruta a separadores del sistema: en la config se escribe con
   * '/' (es portable) y `join` de Windows no acepta mezcla de ambos. */
  return lista.map((c) => ({ ...c, ruta: c.ruta.split('/').join(sep) }));
}
/* Lee el HEAD (hash completo) de un checkout git. Null si no es repo git. */
export function gitHead(dir) {
  try {
    return execFileSync(BIN_GIT, ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

/* Lista de rutas con cambios respecto de su HEAD (porcelain). Null si no es git. */
export function gitSucio(dir) {
  try {
    const out = execFileSync(BIN_GIT, ['-C', dir, 'status', '--porcelain'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return out.split(/\r?\n/).filter((l) => l.length > 0);
  } catch {
    return null;
  }
}
/* Lee y devuelve el manifest del consumidor (objeto) o null si no existe. */
export function leerManifest(dir) {
  const f = join(dir, QITOOLS);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return { __error__: true };
  }
}
/* Compara el commit de una herramienta declarada por el consumidor contra el
 * HEAD real del checkout compartido. Devuelve { estado, detalle }. */
export function compararTool(manifest, dirRepo, tool, headCompartido) {
  const t = manifest?.tools?.[tool];
  /* No declarar una herramienta no es un problema: no aplica. */
  if (!t) return { estado: 'no-declarado', checkout: null, detalle: `el manifiesto no declara '${tool}'` };
  const commitDe = t.commit ?? null;
  /* [por que] La guarda valida consistencia INTERNA: el pin debe coincidir con el
   * HEAD del checkout que el propio manifiesto declara. Exigir el checkout
   * compartido a todos marcaba desync a consumidores coherentes —los del arnés
   * (`../.quality-tools-harness/*`, MN-Inmobiliaria y plugins-opencode) y la
   * familia B (`tools/*`)— y escondía el chequeo que sí importa. Un pin que no
   * cuadra con su propio checkout es desync, apunte donde apunte.
   * `sourcePathEnv` es un NOMBRE de variable, no una ruta: si el manifiesto no
   * declara `sourcePath`, manda el checkout compartido (comportamiento previo). */
  const rutaDirecta = typeof t.sourcePath === 'string' && t.sourcePath.length ? t.sourcePath : null;
  const abs = rutaDirecta ? resolve(dirRepo, rutaDirecta) : null;
  const enCompartido = abs ? esCompartido(abs, tool) : true;
  const headRef = enCompartido ? headCompartido : gitHead(abs);
  const donde = enCompartido ? 'compartido' : rutaDirecta;
  const mismatches = [];
  if (!headRef) {
    mismatches.push(
      enCompartido
        ? 'checkout compartido sin HEAD (no provisto o no es repo git)'
        : `ruta ${rutaDirecta} no es un checkout git legible`,
    );
  } else if (!commitDe || corto(commitDe) !== corto(headRef)) {
    mismatches.push(`commit ${commitDe ? corto(commitDe) : 'sin-commit'} <> ${donde} ${corto(headRef)}`);
  }
  const env = t.sourcePathEnv ? ` (sourcePathEnv=${t.sourcePathEnv})` : '';
  return {
    estado: mismatches.length ? 'desync' : 'ok',
    checkout: enCompartido ? 'compartido' : 'propio',
    detalle: mismatches.length
      ? mismatches.join('; ')
      : `alineado @${corto(headRef)}${enCompartido ? '' : ` (checkout propio ${rutaDirecta})`}${env}`,
  };
}
