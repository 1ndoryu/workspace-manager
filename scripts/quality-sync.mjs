#!/usr/bin/env node
/* quality:sync — valida el commit comun del checkout compartido del gate
 * (308A-1 §F5 / §3.3). Es un script de VALIDACION/CONSISTENCIA en-repo del
 * workspace-manager: NO escribe nada por defecto.
 *
 * [por que] El plan centraliza el runtime en `area-trabajo/.quality-tools/{sentinel,
 * varsense}` y exige que TODOS los consumidores apunten al MISMO commit ("mismo
 * commit para todos = quality:sync falla si uno difiere"). Este script es la
 * guarda: recorre los consumidores del gate, compara el `sentinel.commit` /
 * `varsense.commit` de cada `quality-tools.json` contra el HEAD real del
 * checkout compartido, y falla (fail-closed, exit != 0) si hay desync, un
 * checkout compartido sucio, una ruta que no apunta al compartido, o un
 * consumidor con gate que no tiene `quality-tools.json`.
 *
 * La resolucion es server-side / en-repo: lee el HEAD del checkout compartido y
 * el JSON real de cada consumidor (carpetas exactas del area), igual que el
 * server deriva las env. No muta nada: reporta y sale con codigo de error para
 * poder colgarlo de CI/guard.
 *
 * Uso:  pnpm sync:quality            (recorre los 6 consumidores del gate)
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
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/* Raiz del area (misma fuente del server: WS_AREA_ROOT o el default real). */
const RAIZ_AREA = process.env.WS_AREA_ROOT || 'C:/Users/Owner/OneDrive/Documentos/area-trabajo';
const CHECKOUT = join(RAIZ_AREA, '.quality-tools');

/* Consumidores del gate (mismos del plan §3.3). Rutas reales del area; ONG
 * AGAPE vive bajo TRABAJOS CLIENTES. Los proyectos sin gate (Glory-Laminal,
 * ONG AGAPE) se crean en F4, asi que hoy pueden carecer de quality-tools.json:
 * se reportan como pendiente-F4, no como desync. */
const CONSUMIDORES = [
  { nombre: 'Glory-Laminal', ruta: 'Glory-Laminal', fase: 'F4' },
  { nombre: 'gloryapi', ruta: 'gloryapi', fase: 'F3' },
  { nombre: 'PROYECTO TASKS', ruta: 'PROYECTO TASKS', fase: 'F3' },
  { nombre: 'WANDORIUS', ruta: 'WANDORIUS', fase: 'F2' },
  { nombre: 'RESTAURANTE', ruta: 'RESTAURANTE', fase: 'F2' },
  { nombre: 'ONG AGAPE', ruta: join('TRABAJOS CLIENTES', 'ONG AGAPE'), fase: 'F4' },
  /* Gate ampliado (308A-1 extension, 2026-08-31): todos los proyectos del area
   * con gate declarado, excepto glory-sentinel (exento por ser el runtime). */
  { nombre: 'coolify-manager-rs', ruta: 'coolify-manager-rs', fase: 'F1' },
  { nombre: 'freebuff-bridge', ruta: 'freebuff-bridge', fase: 'F1' },
  { nombre: 'GLORYINSPECTOR', ruta: 'GLORYINSPECTOR', fase: 'F1' },
  { nombre: 'GLORYPORT', ruta: 'GLORYPORT', fase: 'F1' },
  { nombre: 'workspace-manager', ruta: 'workspace-manager', fase: 'F1' },
];

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
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
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
    const out = execFileSync('git', ['-C', dir, 'status', '--porcelain'], {
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
function compararTool(manifest, dirRepo, tool, headCompartido, resaltar) {
  const t = manifest?.tools?.[tool];
  if (!t) return { estado: 'ausente', detalle: `sin tool '${tool}' en el manifest` };
  const commitDe = t.commit ?? null;
  const mismatches = [];
  if (!headCompartido) {
    mismatches.push('checkout compartido sin HEAD (no provisto o no es repo git)');
  } else if (!commitDe || corto(commitDe) !== corto(headCompartido)) {
    mismatches.push(
      `commit ${commitDe ? corto(commitDe) : 'sin-commit'} <> compartido ${headCompartido ? corto(headCompartido) : 'n/a'}`,
    );
  }
  /* Ruta del runtime (219A-2): tres casos. (1) Dentro del checkout compartido:
   * caso normal, nada que anadir (el commit ya se comparo arriba). (2) Dentro
   * del propio repo (familia B, submodulo versionado como WANDORIUS/RESTAURANTE
   * tools/*): legitimo por diseno — se valida pin contra el HEAD del submodulo
   * en vez de exigir la ruta compartida. (3) Fuera de ambos: drift real.
   * sourcePathEnv es un NOMBRE de variable, no una ruta: no se evalua aqui.
   * [por que] 219A-1 exigia la ruta compartida a todos y marcaba desync a dos
   * consumidores coherentes (RESTAURANTE tenia submodulos en el mismo pin);
   * la guarda debe validar consistencia interna, no imponer centralizacion
   * (esa migracion es decision aparte, no un drift). */
  const rutaDirecta = typeof t.sourcePath === 'string' && t.sourcePath.length ? t.sourcePath : null;
  if (rutaDirecta) {
    const abs = resolve(dirRepo, rutaDirecta);
    if (esCompartido(abs, tool)) {
      /* caso 1: ok, sin chequeo extra */
    } else if (keyRuta(abs) === keyRuta(dirRepo) || keyRuta(abs).startsWith(keyRuta(dirRepo) + '\\')) {
      const headSub = gitHead(abs);
      if (!headSub) {
        mismatches.push(`ruta ${rutaDirecta} no es un checkout git legible`);
      } else if (commitDe && corto(commitDe) !== corto(headSub)) {
        mismatches.push(`submodulo ${rutaDirecta} en ${corto(headSub)} <> pin ${corto(commitDe)}`);
      }
    } else {
      mismatches.push(`ruta ${rutaDirecta} no apunta al checkout compartido`);
    }
  }
  const env = t.sourcePathEnv ? ` (sourcePathEnv=${t.sourcePathEnv})` : '';
  return {
    estado: mismatches.length ? 'desync' : 'ok',
    detalle: mismatches.length ? mismatches.join('; ') : 'alineado' + (resaltar ? ` @${corto(headCompartido)}` : ''),
  };
}

function main() {
  const useJson = process.argv.includes('--json');
  const reporte = { area: RAIZ_AREA, checkout: CHECKOUT, consumidores: [] };
  let problemas = 0;

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
  for (const [tool, sub] of Object.entries(HERRAMIENTAS)) {
    if (cabeceras[tool] === null || (sucios[tool] && sucios[tool][0] !== 'no es git')) {
      reporte[`checkout_${tool}`] = {
        head: cabeceras[tool] ? corto(cabeceras[tool]) : null,
        sucio: sucios[tool]?.length ? sucios[tool].length : 0,
      };
      if (sucios[tool]?.[0] === 'no provisto' || sucios[tool]?.[0] !== 'no es git') problemas++;
    }
  }

  /* Recorre consumidores. */
  for (const c of CONSUMIDORES) {
    const dir = join(RAIZ_AREA, c.ruta);
    const manifest = leerManifest(dir);
    const entry = { nombre: c.nombre, fase: c.fase, ruta: c.ruta, problemas: [] };

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

    entry.headShared = {};
    for (const [tool] of Object.entries(HERRAMIENTAS)) {
      const r = compararTool(manifest, dir, tool, cabeceras[tool], true);
      entry[tool] = { estado: r.estado, detalle: r.detalle };
      if (r.estado === 'desync') {
        problemas++;
        entry.problemas.push(`${tool}: ${r.detalle}`);
      }
    }
    entry.estado = entry.problemas.length ? 'desync' : 'ok';
    reporte.consumidores.push(entry);
  }

  reporte.problemas = problemas;

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
        (e.estado === 'ok' ? '✓' : e.estado === 'pendiente-F4' ? '· (F4 pendiente)' : `✗ ${e.problemas.length ? e.problemas.join('; ') : e.detalle || e.estado}`);
      console.log(`  ${e.nombre.padEnd(16)} ${badges}`);
    }
    console.log('');
    if (problemas === 0) {
      console.log(`OK: ${reporte.consumidores.length} consumidores alineados con el checkout compartido.`);
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