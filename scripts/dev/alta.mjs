/* Alta de un proyecto (10AA-2 F10). Por defecto solo comprueba; `--aplicar` crea lo
 * que falta en una rama del proyecto. Lista canónica: Agente/documentacion/alta-proyectos-2026-10-11.md.
 *   alta <id|carpeta> [--aplicar]
 * [por que] El alta estaba repartida entre dos skills y nadie comprobaba que quedara
 * completa. Aquí la lista vive en código; el documento explica el porqué de cada punto.
 * Lo que requiere decisión (Sentinel, varsense, target-dir de Rust, registro en el mando)
 * nunca se crea solo: solo se marca ✗ con la acción. */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { RAIZ } from './gate.mjs';
import { baseDe } from './cierre.mjs';

const ok = (nombre, detalle) => ({ nombre, ok: true, detalle });
const fallo = (nombre, detalle, accion, plan = {}) => ({ nombre, ok: false, detalle, accion, ...plan });
const omitida = (nombre, motivo) => ({ nombre, ok: true, detalle: `omitida: ${motivo}` });

const CARPETAS_AGENTE = ['completados', 'documentacion', 'lecciones', 'planes', 'prevencion'];
const GITIGNORE = ['target/', 'node_modules/', '.quality-reports/', '.runtime/'];
const MANIFIESTOS = [
  ['package.json', 'node'],
  ['Cargo.toml', 'rust'],
  ['pyproject.toml', 'python'],
  ['requirements.txt', 'python'],
  ['go.mod', 'go'],
];
const AGENTS_PROPIOS = ['AGENTS.md', 'CLAUDE.md'];
const IGNORAR_CSS = new Set(['node_modules', 'target', 'dist', '.git', '.quality-tools', 'tools', '.quality-reports', '.runtime']);
const ROADMAP_PLANTILLA = '# Roadmap\n\nTrabajo abierto y orden de ejecución. Historial en `Agente/completados/`; planes en `Agente/planes/` (AGENTS §7.1).\n';
const MENSAJES = {
  docs: 'chore(alta): README, roadmap y Agente/ mínimos (10AA-2 F10)',
  gitignore: 'chore(alta): .gitignore de artefactos (10AA-2 F10)',
};
const RAMA_ALTA = 'alta/10aa-2';

function git(ruta, args) {
  return execFileSync('git', ['-C', ruta, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();
}

function gitOk(ruta, args) {
  try {
    git(ruta, args);
    return true;
  } catch {
    return false;
  }
}

export function comprobarStack(ruta) {
  const stacks = [...new Set(MANIFIESTOS.filter(([f]) => existsSync(join(ruta, f))).map(([, s]) => s))];
  if (stacks.length) return ok('stack', stacks.join(', '));
  return fallo('stack', 'sin manifiesto de stack', 'añade el manifiesto de tu stack (package.json, Cargo.toml…)');
}

export function comprobarGit(ruta) {
  if (!existsSync(ruta) || !gitOk(ruta, ['rev-parse', '--is-inside-work-tree'])) {
    return fallo('git', 'sin repositorio Git', 'git init, un commit en main y origin (AGENTS §5)');
  }
  const base = baseDe(ruta);
  const faltan = [];
  if (!base) faltan.push('rama base (main)');
  if (!gitOk(ruta, ['remote', 'get-url', 'origin'])) faltan.push('remoto origin');
  if (faltan.length === 0) return ok('git', `rama base ${base}, origin configurado`);
  return fallo('git', `falta: ${faltan.join(', ')}`, 'crea la rama base y añade origin a mano (aplicar no lo hace)');
}

export function comprobarReadme(ruta, nombre) {
  if (existsSync(join(ruta, 'README.md'))) return ok('readme', 'README.md');
  return fallo('readme', 'falta README.md', 'crea uno propio (aplicar deja una plantilla mínima)', {
    bloque: 'docs',
    acciones: [{ tipo: 'crear', ruta: 'README.md', contenido: `# ${nombre}\n\nPendiente de documentar.\n` }],
  });
}

export function comprobarRoadmapAgente(ruta) {
  const faltan = [];
  if (!existsSync(join(ruta, 'roadmap.md'))) faltan.push('roadmap.md');
  for (const c of CARPETAS_AGENTE) {
    if (!existsSync(join(ruta, 'Agente', c))) faltan.push(`Agente/${c}/`);
  }
  if (faltan.length === 0) return ok('roadmap-agente', 'roadmap.md y Agente/ completos');
  const acciones = [];
  if (faltan.includes('roadmap.md')) acciones.push({ tipo: 'crear', ruta: 'roadmap.md', contenido: ROADMAP_PLANTILLA });
  for (const f of faltan.filter((x) => x.startsWith('Agente/'))) {
    acciones.push({ tipo: 'crear', ruta: `${f}.gitkeep`, contenido: '' });
  }
  return fallo('roadmap-agente', `falta: ${faltan.join(' ')}`, 'crea roadmap.md y Agente/ (AGENTS §7)', {
    bloque: 'docs',
    acciones,
  });
}

/* El registro vive en el mando (workspace-manager), no en el proyecto: aplicar no lo escribe. */
export function comprobarRegistro(entrada) {
  if (!entrada) {
    return fallo('registro', 'sin entrada en registro.json', 'añádela con la skill dev-bootstrap (aplicar no escribe en el mando)');
  }
  return ok('registro', `entrada «${entrada.id}»`);
}

/* [por que] Con package.json, el gate del proyecto es el script `quality:check` (plan F10.1).
 * Sin package.json (Rust, Python…) no hay script: vale `comandos.gate` del registro (F9.5). */
export function comprobarQualityCheck(ruta, entrada) {
  const pkg = join(ruta, 'package.json');
  if (!existsSync(pkg)) {
    const gate = entrada?.comandos?.gate;
    if (gate) return ok('quality-check', `sin package.json; comandos.gate: ${gate}`);
    return fallo('quality-check', 'sin package.json ni comandos.gate', 'declara comandos.gate en registro.json (F9.5)');
  }
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(pkg, 'utf8').replace(/^﻿/, '')).scripts ?? {};
  } catch (e) {
    return fallo('quality-check', `package.json no se puede leer: ${e.message}`, 'corrige el JSON a mano');
  }
  if (scripts['quality:check']) return ok('quality-check', scripts['quality:check']);
  return fallo('quality-check', 'falta script quality:check', 'añádelo en package.json (lo crea la skill quality-gate-setup)');
}

export function comprobarSentinel(ruta) {
  const archivo = join(ruta, 'sentinel.config.json');
  if (!existsSync(archivo)) {
    return fallo('sentinel', 'sin sentinel.config.json', 'configura Sentinel con la skill quality-gate-setup (AGENTS §9.3)');
  }
  try {
    const version = JSON.parse(readFileSync(archivo, 'utf8').replace(/^﻿/, '')).schemaVersion;
    if (version === 2) return ok('sentinel', 'schemaVersion 2');
    return fallo('sentinel', `schemaVersion ${version}, se espera 2`, 'migra con la skill quality-gate-setup');
  } catch (e) {
    return fallo('sentinel', `no se puede leer: ${e.message}`, 'corrige el JSON a mano');
  }
}

function hayCss(dir, profundidad = 0) {
  if (profundidad > 3) return false;
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entradas.some((e) => {
    if (e.isDirectory()) return !IGNORAR_CSS.has(e.name) && hayCss(join(dir, e.name), profundidad + 1);
    return e.name.endsWith('.css');
  });
}

export function comprobarVarsense(ruta) {
  if (!hayCss(ruta)) return omitida('varsense', 'sin CSS propio');
  if (existsSync(join(ruta, 'varsense.config.json'))) return ok('varsense', 'varsense.config.json');
  return fallo('varsense', 'hay CSS y falta varsense.config.json', 'configúralo con la skill varsense (AGENTS §9.3)');
}

export function comprobarCargo(ruta) {
  if (!existsSync(join(ruta, 'Cargo.toml'))) return omitida('cargo-target', 'no es Rust');
  const archivo = join(ruta, '.cargo', 'config.toml');
  if (existsSync(archivo) && /^\s*target-dir\s*=/m.test(readFileSync(archivo, 'utf8'))) {
    return ok('cargo-target', 'target-dir declarado');
  }
  return fallo('cargo-target', 'falta .cargo/config.toml con target-dir', 'decide la ruta fuera del proyecto (AGENTS §0.2); aplicar no la elige');
}

export function comprobarGitignore(ruta) {
  const archivo = join(ruta, '.gitignore');
  const lineas = new Set(existsSync(archivo) ? readFileSync(archivo, 'utf8').split(/\r?\n/).map((l) => l.trim()) : []);
  const faltan = GITIGNORE.filter((p) => {
    const variantes = [p, p.slice(0, -1), `/${p}`, `/${p.slice(0, -1)}`];
    return !variantes.some((v) => lineas.has(v));
  });
  if (faltan.length === 0) return ok('gitignore', 'artefactos cubiertos');
  return fallo('gitignore', `faltan: ${faltan.join(' ')}`, 'añádelas al final sin tocar lo existente', {
    bloque: 'gitignore',
    acciones: [{ tipo: 'anadir', ruta: '.gitignore', lineas: faltan }],
  });
}

export function comprobarSinAgentsPropios(ruta) {
  const hallados = AGENTS_PROPIOS.filter((f) => existsSync(join(ruta, f)));
  if (hallados.length === 0) return ok('sin-agents-propios', 'ninguno');
  return fallo('sin-agents-propios', `existe: ${hallados.join(', ')}`, 'retíralos a mano: se autocargan en cada sesión (AGENTS §0); aplicar no borra nada');
}

export function comprobarAlta(ruta, entrada, nombre = basename(ruta)) {
  return [
    comprobarStack(ruta),
    comprobarGit(ruta),
    comprobarReadme(ruta, nombre),
    comprobarRoadmapAgente(ruta),
    comprobarRegistro(entrada),
    comprobarSentinel(ruta),
    comprobarVarsense(ruta),
    comprobarQualityCheck(ruta, entrada),
    comprobarCargo(ruta),
    comprobarGitignore(ruta),
    comprobarSinAgentsPropios(ruta),
  ];
}

function aplicarAccion(ruta, a) {
  const destino = join(ruta, a.ruta);
  if (a.tipo === 'crear') {
    if (existsSync(destino)) throw new Error(`${a.ruta} ya existe; no se sobrescribe`);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, a.contenido);
    return;
  }
  const actual = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
  const separador = actual.length && !actual.endsWith('\n') ? '\n' : '';
  appendFileSync(destino, `${separador}# alta 10AA-2 F10\n${a.lineas.join('\n')}\n`);
}

/* Aplica los bloques pendientes en la rama `alta/10aa-2`, un commit por bloque.
 * [por que] Se niega si la base no está en curso, si hay cambios en el índice o en
 * archivos que tocaría, o si la rama ya existe: nunca mezcla ni pisa trabajo ajeno. */
export function aplicarAlta(ruta, items) {
  const porBloque = new Map();
  for (const it of items) {
    if (it.ok || !it.bloque) continue;
    porBloque.set(it.bloque, [...(porBloque.get(it.bloque) ?? []), ...it.acciones]);
  }
  if (porBloque.size === 0) return ['nada que aplicar'];
  if (!gitOk(ruta, ['rev-parse', '--is-inside-work-tree'])) throw new Error('aplicar necesita un repo Git');
  const base = baseDe(ruta);
  if (!base) throw new Error('aplicar necesita una rama base (main)');
  const actual = git(ruta, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (actual !== base) throw new Error(`aplicar corre desde ${base}; estás en ${actual}`);
  if (git(ruta, ['diff', '--cached', '--name-only']).length) throw new Error('hay cambios en el índice; no se mezclan con el alta');
  if (gitOk(ruta, ['rev-parse', '--verify', '-q', RAMA_ALTA])) throw new Error(`la rama ${RAMA_ALTA} ya existe; intégrala o bórrala antes`);
  const rutas = [...porBloque.values()].flat().map((a) => a.ruta);
  const sucio = git(ruta, ['status', '--porcelain', '--', ...rutas]);
  if (sucio) throw new Error(`hay cambios sin commit en archivos del alta:\n${sucio}`);

  git(ruta, ['checkout', '-b', RAMA_ALTA]);
  const log = [];
  for (const [bloque, acciones] of porBloque) {
    for (const a of acciones) aplicarAccion(ruta, a);
    const archivos = acciones.map((a) => a.ruta);
    git(ruta, ['add', '--', ...archivos]);
    git(ruta, ['commit', '-m', MENSAJES[bloque]]);
    log.push(`commit ${bloque}: ${archivos.join(', ')}`);
  }
  log.push(`rama ${RAMA_ALTA} lista para integrar en ${base} (AGENTS §5)`);
  return log;
}

const norma = (p) => resolve(p).replace(/\\/g, '/').toLowerCase();

/* [por que] `--json` lo usa el tablero (F10): solo estado por ítem, sin el contenido de
 * las acciones. Pendientes = código 1, que es un resultado normal y no un fallo. */
export async function alta(argv, raiz = RAIZ) {
  const aplicar = argv.includes('--aplicar');
  const json = argv.includes('--json');
  const objetivo = argv.find((a) => !a.startsWith('--'));
  if (!objetivo) {
    console.error('uso: alta <id|carpeta> [--aplicar] [--json]');
    return 1;
  }
  if (aplicar && json) {
    console.error('alta: --json no combina con --aplicar');
    return 1;
  }
  try {
    const registro = JSON.parse(readFileSync(join(raiz, 'scripts', 'dev', 'registro.json'), 'utf8'));
    const porId = registro.proyectos.find((x) => x.id === objetivo);
    const ruta = porId ? resolve(raiz, porId.ruta) : resolve(objetivo);
    if (!existsSync(ruta)) {
      console.error(`alta: no existe ${objetivo}`);
      return 1;
    }
    const entrada = porId ?? registro.proyectos.find((x) => norma(resolve(raiz, x.ruta)) === norma(ruta));
    const etiqueta = entrada?.id ?? basename(ruta);

    let items = comprobarAlta(ruta, entrada, etiqueta);
    if (aplicar) {
      for (const linea of aplicarAlta(ruta, items)) console.log(`→ ${linea}`);
      items = comprobarAlta(ruta, entrada, etiqueta);
    }
    const hechos = items.filter((it) => it.ok).length;
    const pendientes = items.length - hechos;
    if (json) {
      const planos = items.map(({ nombre, ok, detalle, accion }) => ({ nombre, ok, detalle, accion }));
      console.log(JSON.stringify({ etiqueta, hechos, total: items.length, items: planos }));
      return pendientes === 0 ? 0 : 1;
    }
    for (const it of items) {
      console.log(`${it.ok ? '✓' : '✗'} ${it.nombre} — ${it.detalle}`);
      if (!it.ok) console.log(`    → ${it.accion}`);
    }
    console.log(`alta ${etiqueta}: ${hechos}/${items.length}${pendientes ? ` (${pendientes} pendiente(s))` : ': completa'}`);
    return pendientes === 0 ? 0 : 1;
  } catch (e) {
    console.error(`alta: ${e?.message ?? e}`);
    return 1;
  }
}
