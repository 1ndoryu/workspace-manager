#!/usr/bin/env node
/**
 * 318A-7V19 — Reporter de alineación sentinel/varsense por consumidor.
 *
 * Detecta el desalineamiento entre las TRES capas que definen qué versión de
 * una herramienta de análisis ejecuta (y debería ejecutar) cada repo del área:
 *
 *   pin       = commit DECLARADO en quality-tools.json del consumidor
 *   runtime   = commit del checkout PROVISIONADO que realmente ejecuta
 *               (sourcePath del quality-tools.json; gitlink tools/<tool>
 *               cuando el consumidor usa submódulos)
 *   publicado = commit ALCANZABLE desde los releaseRefs declarados del
 *               checkout (refs/remotes/origin/main + refs/tags/v*)
 *
 * Estados por herramienta:
 *   ALINEADO          pin == runtime y pin publicado → sin acción
 *   RUNTIME-DESFASADO pin != runtime (el checkout provisionado ejecuta otro
 *                     commit: el dist del runtime lleva fixes que el pin no
 *                     declara, o el checkout quedó atrás del pin)
 *   NO-PUBLICADO      pin no alcanzable desde releaseRefs del checkout (el
 *                     commit vive solo en el checkout local; un clon fresco no
 *                     podría reproducirlo)
 *   PIN-INVALIDO      el pin no existe como objeto git en el checkout
 *   SIN-PROVISION     el consumidor no declara la herramienta (p. ej. uno que solo usa
 *                     sentinel) → no es un problema
 *
 * Uso:
 *   node scripts/quality/auditoria/verificar-alineacion.mjs [proyecto] [--json]
 *
 * Exit: 0 si TODOS los proyectos×herramientas están ALINEADO (o SIN-PROVISION);
 *       1 si hay algún desalineamiento; 2 si falla la resolución (checkout
 *       ausente). Sirve de guard para CI/gate: un release de varsense/sentinel
 *       que no haya llegado a todos los pins rompe el veredicto.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RAIZ_REPO, rutaConfigPrivada } from '../../shared/rutas.mjs';
import { BIN_GIT } from '../../shared/binarios.mjs';

/* Mapa id → ruta absoluta del repo, derivado del registro privado.
 * [por que] Antes era una lista de proyectos incrustada en el código: ataba el
 * script al área de una máquina concreta. El registro ya declara `id` y `ruta`
 * de cada proyecto (`ruta` es relativa a RAIZ_REPO), así que aquí solo se
 * resuelve. */
function reposDelRegistro() {
  const reg = JSON.parse(readFileSync(rutaConfigPrivada('registro.json'), 'utf8'));
  return new Map(reg.proyectos.map((p) => [p.id, resolve(RAIZ_REPO, p.ruta)]));
}

/* Memoria de consultas git de ESTA corrida.
 * [por que] El script es de solo lectura (no muta ningún repo), así que la
 * misma consulta sobre el mismo checkout devuelve siempre lo mismo y se
 * responde una sola vez. Sin esto, la comprobación se repetía por cada
 * consumidor: 20 consumidores apuntando a los mismos checkouts compartidos
 * producían 580 procesos git (162 de ellos `merge-base --is-ancestor` del
 * mismo pin contra las mismas refs) y el panel tardaba 25,9 s en pintar el
 * estado, casi todo en arrancar procesos, no en trabajar. La clave incluye el
 * cwd y los argumentos: es la identidad exacta de la consulta. */
const MEMO = new Map();

function git(cwd, ...args) {
  const clave = `${cwd}\0${args.join('\0')}`;
  if (MEMO.has(clave)) return MEMO.get(clave);
  let valor;
  try {
    valor = execFileSync(BIN_GIT, ['-C', cwd, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    }).trim();
  } catch {
    valor = null;
  }
  MEMO.set(clave, valor);
  return valor;
}

function corto(h) { return h ? h.slice(0, 9) : '--'; }

/** Expande releaseRefs (refs/tags/v* → refs concretos existentes). */
function expandirRefs(checkout, releaseRefs) {
  const refs = [];
  for (const ref of releaseRefs || []) {
    if (ref.includes('*')) {
      const lista = git(checkout, 'for-each-ref', '--format=%(refname)', ref);
      if (lista) refs.push(...lista.split('\n').filter(Boolean));
    } else {
      refs.push(ref);
    }
  }
  return refs;
}

/** ¿pin alcanzable desde alguna releaseRef (publicado)?
 * [por que] Antes se preguntaba `merge-base --is-ancestor` ref a ref, que es
 * un proceso git por cada tag: un pin NO publicado obliga a recorrer las ~29
 * tags del checkout (118 procesos en el área). `for-each-ref --contains` es la
 * misma pregunta —qué refs alcanzan el pin— resuelta en UNA llamada; luego se
 * cruza con las releaseRefs declaradas. Semántica idéntica (incluye el caso
 * pin == ref), sin el coste por ref. */
function estaPublicado(checkout, pin, refs) {
  if (!pin || !checkout) return null; // indeterminado (sin checkout)
  if (refs.length === 0) return false;
  const lista = git(checkout, 'for-each-ref', '--contains', pin, '--format=%(refname)');
  /* Un fallo de git se trata como "no publicado", igual que antes (donde el
   * exit != 0 de merge-base daba false). */
  if (lista === null) return false;
  const alcanzan = new Set(lista.split('\n').filter(Boolean));
  return refs.some((r) => alcanzan.has(r));
}

/** ¿pin existe como objeto en el checkout? */
function existeCommit(checkout, pin) {
  if (!checkout || !pin) return false;
  return git(checkout, 'cat-file', '-e', `${pin}^{commit}`) === '';
}

/** runtime del consumidor: HEAD del sourcePath, o gitlink tools/<tool>. */
function resolverRuntime(repoDir, tool, cfg) {
  if (cfg.sourcePath) {
    const chk = resolve(repoDir, cfg.sourcePath);
    if (!existsSync(chk)) return { modo: 'ausente', commit: null, dir: chk };
    const head = git(chk, 'rev-parse', 'HEAD');
    return { modo: 'sourcePath', commit: head, dir: chk };
  }
  // Sin sourcePath → gitlink/submódulo (patrón de submódulos tools/*).
  const ls = git(repoDir, 'ls-files', '-s', `tools/${tool}`);
  const m = ls && /^160000\s+([0-9a-f]{40})/.exec(ls);
  if (m) return { modo: 'gitlink', commit: m[1], dir: join(repoDir, `tools/${tool}`) };
  return { modo: 'gitlink-ausente', commit: null, dir: join(repoDir, `tools/${tool}`) };
}

function analizarTool(repoDir, tool, cfg) {
  const pin = String(cfg.commit || '').trim() || null;
  const rt = resolverRuntime(repoDir, tool, cfg);
  const problemas = [];
  let estado;

  if (!pin) {
    return { tool, estado: 'SIN-PIN', problemas: ['sin commit declarado'], pin: null, runtime: rt.commit, publicado: null, modo: rt.modo };
  }
  if (rt.modo === 'ausente' || rt.modo === 'gitlink-ausente') {
    return { tool, estado: 'SIN-PROVISION', problemas: [], pin, runtime: rt.commit, publicado: null, modo: rt.modo };
  }

  const publicado = estaPublicado(rt.dir, pin, expandirRefs(rt.dir, cfg.releaseRefs));
  const pinExiste = existeCommit(rt.dir, pin);

  if (!pinExiste) {
    problemas.push('PIN-INVALIDO: el commit declarado no existe en el checkout');
    estado = 'PIN-INVALIDO';
  } else {
    if (publicado === false) problemas.push(`NO-PUBLICADO: pin ${corto(pin)} no alcanzable desde ${(cfg.releaseRefs || []).join(' | ')}`);
    if (rt.commit && pin !== rt.commit) {
      problemas.push(`RUNTIME-DESFASADO: pin ${corto(pin)} pero el checkout ejecuta ${corto(rt.commit)}`);
    }
    if (problemas.length === 0) estado = 'ALINEADO';
    else if (publicado === null) estado = 'INDETERMINADO';
  }
  if (!estado) estado = problemas.length ? 'DESALINEADO' : 'ALINEADO';
  return { tool, estado, problemas, pin, runtime: rt.commit, publicado: publicado === true, modo: rt.modo, releaseRefs: cfg.releaseRefs, dir: rt.dir };
}

/* Compara versiones semver con o sin 'v' (para ordenar tags remotos). */
function cmpSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/* ¿El checkout va por detras de su origin? (219A-1)
 * [por que] V19 comparaba pin vs runtime vs publicado local, pero un pin y un
 * runtime ALINEADOS pueden estar ambos obsoletos (caso 0.7.10 vs tags
 * v0.7.11/v0.7.12). Se pregunta al remoto por HEAD y tags con ls-remote
 * (sin fetch, sin mutar nada). Fail-open: sin remoto o sin red el resultado es
 * desactualizado=null (desconocido), nunca un desalineamiento. No toca el exit
 * del script: es informacion para el panel, no guarda de CI. */
function remotoUpstream(dir, tool) {
  const base = { dir, tool, url: null, headLocal: null, headRemoto: null, tags: [], desactualizado: null };
  if (!dir || !existsSync(dir)) return base;
  base.headLocal = git(dir, 'rev-parse', 'HEAD');
  const url = git(dir, 'remote', 'get-url', 'origin');
  if (!url) return base;
  base.url = url;
  /* Un solo ls-remote sin filtros: devuelve HEAD y las tags en el MISMO viaje
   * de red. [por que] Antes eran dos llamadas (una por HEAD, otra por tags)
   * contra el remoto, y contra un remoto de verdad cada una es una ida y vuelta
   * completa: aquí el informe entero esperaba al doble de round-trips. El
   * listado sin filtros trae HEAD y refs/tags/* igual que las dos consultas
   * separadas; solo añade refs/heads/*, que se ignora. */
  const out = git(dir, 'ls-remote', url);
  if (out) {
    for (const ln of out.split('\n')) {
      const m = /^([0-9a-f]{40})\s+(.+)$/.exec(ln.trim());
      if (!m) continue;
      if (m[2] === 'HEAD') {
        base.headRemoto = m[1];
        continue;
      }
      const t = /^refs\/tags\/(.+)$/.exec(m[2]);
      if (t && !t[1].endsWith('^{}') && /^v?\d+\.\d+\.\d+$/.test(t[1])) {
        base.tags.push({ tag: t[1], commit: m[1] });
      }
    }
    base.tags.sort((a, b) => cmpSemver(b.tag, a.tag));
    base.tags = base.tags.slice(0, 5);
  }
  if (base.headRemoto && base.headLocal) {
    base.desactualizado = base.headRemoto.toLowerCase() !== base.headLocal.toLowerCase();
  }
  return base;
}

function main() {
  const arg = process.argv[2];
  const json = process.argv.includes('--json');
  const filtro = arg && !arg.startsWith('--') ? arg : null;
  const repos = reposDelRegistro();
  if (filtro && !repos.has(filtro)) {
    console.error(`Proyecto desconocido: ${filtro}. Disponibles: ${[...repos.keys()].join(', ')}`);
    process.exit(2);
  }

  const filas = [];
  for (const [nombre, repoDir] of repos) {
    if (filtro && nombre !== filtro) continue;
    const qPath = join(repoDir, 'quality-tools.json');
    if (!existsSync(qPath)) {
      filas.push({ proyecto: nombre, herramienta: '(sin quality-tools.json)', estado: 'SIN-CONFIG', problemas: [], pin: null, runtime: null, publicado: null });
      continue;
    }
    let qt;
    try { qt = JSON.parse(readFileSync(qPath, 'utf8')); } catch {
      filas.push({ proyecto: nombre, herramienta: '(config inválida)', estado: 'SIN-CONFIG', problemas: [], pin: null, runtime: null, publicado: null });
      continue;
    }
    const tools = Object.keys(qt.tools || {}).filter((t) => ['sentinel', 'varsense'].includes(t));
    if (tools.length === 0) {
      filas.push({ proyecto: nombre, herramienta: '(sin sentinel/varsense)', estado: 'SIN-PROVISION', problemas: [], pin: null, runtime: null, publicado: null });
      continue;
    }
    for (const t of tools.sort()) {
      filas.push({ proyecto: nombre, ...analizarTool(repoDir, t, qt.tools[t]) });
    }
  }

  const desalineados = filas.filter((f) => !['ALINEADO', 'SIN-PROVISION'].includes(f.estado));

  /* Chequeo upstream por checkout distinto (219A-1): un dir = un runtime.
   * [por que] Deduplicado por dir para no repetir ls-remote cuando varios
   * consumidores comparten el mismo checkout (caso comun del area). */
  const remotos = [];
  const vistos = new Map();
  for (const f of filas) {
    if (!f.dir || vistos.has(f.dir)) continue;
    vistos.set(f.dir, true);
    remotos.push(remotoUpstream(f.dir, f.tool || null));
  }

  if (json) {
    console.log(JSON.stringify({ filas, alineados: filas.length - desalineados.length, total: filas.length, desalineados: desalineados.length, ok: desalineados.length === 0, remotos }, null, 2));
  } else {
    console.log('Alineación sentinel/varsense por consumidor (pin | runtime | publicado):');
    console.log('-'.repeat(120));
    for (const f of filas) {
      console.log(
        `${f.proyecto.padEnd(20)} ${(f.herramienta || '').padEnd(10)} ${f.estado.padEnd(18)} ` +
        `pin=${corto(f.pin)} runtime=${corto(f.runtime)}${f.publicado === true ? ' publicado=SI' : f.publicado === false ? ' publicado=NO' : ''}${f.modo ? ` [${f.modo}]` : ''}`,
      );
      for (const p of f.problemas || []) console.log(`  ${' '.repeat(31)}⚠ ${p}`);
    }
    console.log('-'.repeat(120));
    if (desalineados.length === 0) console.log(`OK: ${filas.length} filas, todo ALINEADO.`);
    else console.log(`DESALINEADO: ${desalineados.length}/${filas.length} filas requieren acción (exit 1).`);
    console.log('Upstream por checkout (ls-remote, sin fetch):');
    for (const r of remotos) {
      const marca = r.desactualizado === true ? 'DESACTUALIZADO' : r.desactualizado === false ? 'al día' : 'desconocido';
      console.log(`  ${(r.tool || '?').padEnd(10)} ${marca} local=${corto(r.headLocal)} remoto=${corto(r.headRemoto)}${r.tags.length ? ` tags=${r.tags.map((t) => t.tag).join(',')}` : ''}`);
    }
  }
  process.exit(desalineados.length === 0 ? 0 : 1);
}

main();
