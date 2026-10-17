#!/usr/bin/env node
/* quality:sync — valida el commit comun del checkout compartido del gate
 * (308A-1 §F5 / §3.3). Es un script de VALIDACION/CONSISTENCIA en-repo del
 * workspace-manager: NO escribe nada por defecto.
 *
 * [por que] El plan centraliza el runtime en `<area>/.quality-tools/{sentinel,
 * varsense}` y exige que TODOS los consumidores apunten al MISMO commit ("mismo
 * commit para todos = quality:sync falla si uno difiere"). Este script es la
 * guarda: recorre los consumidores del gate, compara el `sentinel.commit` /
 * `varsense.commit` de cada `quality-tools.json` contra el HEAD real del
 * checkout que ese mismo manifiesto declara —el compartido para casi todos, el
 * del arnés (`../.quality-tools-harness/*`) o el submódulo propio (familia B)
 * para el resto— y falla (fail-closed, exit != 0) si hay desync, un checkout
 * compartido sucio o no provisto, o un consumidor con gate que no tiene
 * `quality-tools.json`. No declarar una herramienta no es un problema.
 *
 * La resolucion es server-side / en-repo: lee el HEAD del checkout compartido y
 * el JSON real de cada consumidor (carpetas exactas del area), igual que el
 * server deriva las env. No muta nada: reporta y sale con codigo de error para
 * poder colgarlo de CI/guard.
 *
 * Los consumidores NO van en el codigo: son configuracion del area y viven en
 * `config/quality-consumidores.json` (privada, con ejemplo versionado). Sin ese
 * archivo el script informa y sale en verde, que es lo que le toca a un clone
 * recien hecho.
 *
 * Uso:  pnpm sync:quality            (recorre los consumidores declarados)
 *       pnpm sync:quality --json      (salida JSON en stdout)
 *
 * Exit codes:
 *   0  todos los consumidores con gate apuntan al commit comun y al checkout
 *      compartido con rutas limpias
 *   1  desync (commit distinto, ruta no compartida, checkout sucio, o falta
 *      quality-tools.json en un consumidor con gate, o checkout compartido
 *      no provisto)
 *   2  error de entorno/data (no se pudo leer algo, area no hallada) */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

/* Raiz del area (misma fuente del server: WS_AREA_ROOT o el default real). */
import { RAIZ_AREA, rutaConfigPrivada } from './shared/rutas.mjs';
import { BIN_GIT } from './shared/binarios.mjs';
const CHECKOUT = join(RAIZ_AREA, '.quality-tools');

/* Consumidores del gate: QUE proyectos del area reciben el pin. [por que] Es
 * configuracion nuestra, no del producto: la lista de nuestros proyectos no
 * puede ir en el repo que se publica. Vive en la config privada
 * (`config/quality-consumidores.json`), con ejemplo versionado. Sin ella el
 * script no falla: informa de que no hay consumidores declarados y sale en
 * verde, porque un clone recien hecho no tiene ninguno que validar. */
function leerConsumidores() {
  const ruta = rutaConfigPrivada('quality-consumidores.json');
  if (!existsSync(ruta)) return null;
  const data = JSON.parse(readFileSync(ruta, 'utf8'));
  const lista = Array.isArray(data?.consumidores) ? data.consumidores : null;
  if (!lista) throw new Error(`'quality-consumidores.json' sin array 'consumidores' en ${ruta}`);
  /* Normaliza la ruta a separadores del sistema: en la config se escribe con
   * '/' (es portable) y `join` de Windows no acepta mezcla de ambos. */
  return lista.map((c) => ({ ...c, ruta: c.ruta.split('/').join(sep) }));
}

/* Herramientas del checkout compartido y su subcarpeta. */
const HERRAMIENTAS = {
  sentinel: 'sentinel',
  varsense: 'varsense',
};

/* Cabecera del archivo de manifest del consumidor. [por que] `quality-tools.json`
 * es el contrato del gate por consumidor; el `commit` de cada tool es lo que este
 * script compara contra el HEAD del checkout compartido. */
const QITOOLS = 'quality-tools.json';

/* Lee el HEAD (hash completo) de un checkout git. Null si no es repo git. */
function gitHead(dir) {
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
function gitSucio(dir) {
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

/* Normaliza una ruta absoluta a una comparacion portable (lowercase en
 * Windows; el server corre en Windows). */
function keyRuta(p) {
  if (!p) return p;
  return p.replace(/\//g, '\\').replace(/\\\\+/g, '\\').toLowerCase();
}

/* True si el consumidor senala el checkout compartido (sourcePathEnv declarado
 * para la herramienta, o sourcePath que resuelve dentro de .quality-tools). */
function esCompartido(relPath, tool) {
  const base = keyRuta(CHECKOUT);
  const destacada = keyRuta(join(CHECKOUT, tool));
  const r = keyRuta(relPath);
  if (!r) return false;
  // mayusculas de driveletter/lowercase: keyRuta ya bajo
  return r.includes(destacada) || r === base || r.includes(base + '\\');
}

/* Lee y devuelve el manifest del consumidor (objeto) o null si no existe. */
function leerManifest(dir) {
  const f = join(dir, QITOOLS);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return { __error__: true };
  }
}

/* Normaliza el commit a forma corta (primeros 12 chars) para comparar igual que
 * el checkout compartido y los archivos del area (muchos usan hash corto). */
function corto(h) {
  if (!h || typeof h !== 'string') return h;
  return h.toLowerCase().slice(0, 12);
}

/* Compara el commit de una herramienta declarada por el consumidor contra el
 * HEAD real del checkout compartido. Devuelve { estado, detalle }. */
function compararTool(manifest, dirRepo, tool, headCompartido) {
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

function main() {
  const useJson = process.argv.includes('--json');
  const consumidores = leerConsumidores();
  const reporte = {
    area: RAIZ_AREA,
    checkout: CHECKOUT,
    consumidores: [],
    ...(consumidores ? {} : { sinConsumidores: true }),
  };
  let problemas = 0;
  const sinDirectorio = [];

  /* Sin config de consumidores no hay nada que validar: se informa y se sale en
   * verde. Un clone del repo no trae la lista (es configuracion del area), asi
   * que fallar aqui seria fallar por no tener nuestros datos. */
  if (!consumidores) {
    if (useJson) console.log(JSON.stringify(reporte, null, 2));
    else {
      console.log(`sin consumidores declarados: no hay ${rutaConfigPrivada('quality-consumidores.json')}`);
      console.log('Copialo de config/ejemplos/quality-consumidores.example.json y pon tus proyectos.');
    }
    return 0;
  }

  /* HEAD y limpieza de cada herramienta del checkout compartido. */
  const cabeceras = {};
  const sucios = {};
  for (const [tool, sub] of Object.entries(HERRAMIENTAS)) {
    const dir = join(CHECKOUT, sub);
    if (!existsSync(dir)) {
      cabeceras[tool] = null;
      sucios[tool] = ['no provisto'];
      continue;
    }
    cabeceras[tool] = gitHead(dir);
    const dirty = gitSucio(dir);
    if (dirty === null) sucios[tool] = ['no es git'];
    else if (dirty.length) sucios[tool] = dirty;
  }
  /* Un checkout compartido limpio no es un problema: se cuenta solo lo que de
   * verdad lo es (no provisto o sucio). Antes la condición daba por sucio todo
   * checkout limpio —`sucios[tool]` es `[]`, que es *truthy*, y `[][0]` no es
   * `'no es git'`— y el área sana salía con 2 problemas fantasma. */
  for (const [tool, sub] of Object.entries(HERRAMIENTAS)) {
    const noProvisto = sucios[tool]?.[0] === 'no provisto';
    const sucio = Array.isArray(sucios[tool]) && sucios[tool].length > 0;
    if (!noProvisto && !sucio) continue;
    reporte[`checkout_${tool}`] = {
      head: cabeceras[tool] ? corto(cabeceras[tool]) : null,
      sucio: noProvisto ? 0 : sucios[tool].length,
    };
    problemas++;
  }

  /* Recorre consumidores. */
  for (const c of consumidores) {
    const dir = join(RAIZ_AREA, c.ruta);
    const entry = { nombre: c.nombre, fase: c.fase, ruta: c.ruta, problemas: [] };

    /* Proyecto registrado cuyo directorio no está en el área: no hay pin que
     * validar. Se reporta como tal —no como desync, que sería un diagnóstico
     * falso— y no cuenta como problema del gate. */
    if (!existsSync(dir)) {
      entry.estado = 'sin-directorio';
      entry.detalle = `no existe ${dir} en el área (registro obsoleto o repo fuera)`;
      sinDirectorio.push(c.nombre);
      reporte.consumidores.push(entry);
      continue;
    }

    const manifest = leerManifest(dir);
    if (!manifest) {
      entry.estado = c.fase === 'F4' ? 'pendiente-F4' : 'sin-manifest';
      entry.detalle =
        c.fase === 'F4'
          ? 'no tiene gate aun (F4 crea quality-tools.json)'
          : 'consumidor con gate sin quality-tools.json (desync)';
      if (c.fase !== 'F4') problemas++;
      reporte.consumidores.push(entry);
      continue;
    }
    if (manifest.__error__) {
      entry.estado = 'error';
      entry.detalle = `${QITOOLS} corrupto/no leido`;
      problemas++;
      reporte.consumidores.push(entry);
      continue;
    }

    for (const [tool] of Object.entries(HERRAMIENTAS)) {
      const r = compararTool(manifest, dir, tool, cabeceras[tool]);
      entry[tool] = { estado: r.estado, checkout: r.checkout, detalle: r.detalle };
      if (r.estado === 'desync') {
        problemas++;
        entry.problemas.push(`${tool}: ${r.detalle}`);
      }
    }
    entry.estado = entry.problemas.length ? 'desync' : 'ok';
    reporte.consumidores.push(entry);
  }

  reporte.problemas = problemas;
  reporte.sinDirectorio = sinDirectorio;

  if (useJson) {
    console.log(JSON.stringify(reporte, null, 2));
  } else {
    console.log(`area: ${RAIZ_AREA}`);
    console.log(`checkout compartido: ${CHECKOUT}`);
    for (const tool of Object.keys(HERRAMIENTAS)) {
      const h = cabeceras[tool];
      const dirty = sucios[tool];
      console.log(
        `  ${tool}: head=${h ? corto(h) : 'NO-PROVISTO'}${dirty?.length ? `  (sucio ${dirty.length})` : ''}`,
      );
    }
    console.log('');
    for (const e of reporte.consumidores) {
      const badges =
        (e.sentinel ? `sentinel=${e.sentinel.estado} ` : '') +
        (e.varsense ? `varsense=${e.varsense.estado} ` : '') +
        (e.estado === 'ok'
          ? '✓'
          : e.estado === 'pendiente-F4'
            ? '· (F4 pendiente)'
            : e.estado === 'sin-directorio'
              ? '· (sin directorio en el área)'
              : `✗ ${e.problemas.length ? e.problemas.join('; ') : e.detalle || e.estado}`);
      console.log(`  ${e.nombre.padEnd(16)} ${badges}`);
    }
    console.log('');
    if (sinDirectorio.length) {
      console.log(
        `· ${sinDirectorio.length} registrado(s) sin directorio en el área, no validables: ${sinDirectorio.join(', ')}`,
      );
    }
    if (problemas === 0) {
      console.log(`OK: ${reporte.consumidores.length} consumidores registrados, sin desync de gate.`);
      return 0;
    }
    console.error(`DESYNC: ${problemas} problema(s) de consistencia del gate.`);
    for (const e of reporte.consumidores) {
      if (e.estado === 'desync' || e.estado === 'error' || e.estado === 'sin-manifest') {
        console.error(`  - ${e.nombre}: ${e.problemas.length ? e.problemas.join('; ') : e.detalle}`);
      }
    }
    return 1;
  }
  return problemas === 0 ? 0 : 1;
}

process.exit(main());