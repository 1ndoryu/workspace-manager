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
 *               cuando el consumidor usa submódulos, p. ej. WANDORIUS)
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
 *   SIN-PROVISION     el consumidor no declara la herramienta (p. ej. gloryapi
 *                     solo usa sentinel) → no es un problema
 *
 * Uso:
 *   node scripts/quality/verificar-alineacion.mjs [proyecto] [--json]
 *
 * Exit: 0 si TODOS los proyectos×herramientas están ALINEADO (o SIN-PROVISION);
 *       1 si hay algún desalineamiento; 2 si falla la resolución (checkout
 *       ausente). Sirve de guard para CI/gate: un release de varsense/sentinel
 *       que no haya llegado a todos los pins rompe el veredicto.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AREA = resolve(__dirname, '../../..');

// Mismo mapa que analyze-blocks.mjs — proyectos con análisis activo.
const PROYECTOS = {
  'workspace-manager': 'workspace-manager',
  RESTAURANTE: 'RESTAURANTE',
  'ONG AGAPE': 'TRABAJOS CLIENTES/ONG AGAPE',
  WANDORIUS: 'WANDORIUS',
  'coolify-manager-rs': 'coolify-manager-rs',
  gloryapi: 'gloryapi',
  'Glory-Laminal': 'Glory-Laminal',
  GLORYPORT: 'GLORYPORT',
  'PROYECTO TASKS': 'PROYECTO TASKS',
};

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    }).trim();
  } catch {
    return null;
  }
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

/** ¿pin alcanzable desde alguna releaseRef (publicado)? */
function estaPublicado(checkout, pin, refs) {
  if (!pin || !checkout) return null; // indeterminado (sin checkout)
  for (const r of refs) {
    const ok = git(checkout, 'merge-base', '--is-ancestor', pin, r);
    if (ok === '') return true; // ancestro → alcanzable
  }
  return false;
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
  // Sin sourcePath → gitlink/submódulo (patrón WANDORIUS tools/*).
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
  return { tool, estado, problemas, pin, runtime: rt.commit, publicado: publicado === true, modo: rt.modo, releaseRefs: cfg.releaseRefs };
}

function main() {
  const arg = process.argv[2];
  const json = process.argv.includes('--json');
  const filtro = arg && !arg.startsWith('--') ? arg : null;
  if (filtro && !PROYECTOS[filtro]) {
    console.error(`Proyecto desconocido: ${filtro}. Disponibles: ${Object.keys(PROYECTOS).join(', ')}`);
    process.exit(2);
  }

  const filas = [];
  for (const [nombre, rel] of Object.entries(PROYECTOS)) {
    if (filtro && nombre !== filtro) continue;
    const repoDir = join(AREA, rel);
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
  if (json) {
    console.log(JSON.stringify({ filas, alineados: filas.length - desalineados.length, total: filas.length, desalineados: desalineados.length, ok: desalineados.length === 0 }, null, 2));
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
  }
  process.exit(desalineados.length === 0 ? 0 : 1);
}

main();
