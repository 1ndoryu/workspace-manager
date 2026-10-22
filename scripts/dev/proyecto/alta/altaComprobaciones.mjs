/* Comprobaciones del alta (E/S: disco y git). Solo leen: no crean ni modifican nada;
 * eso es de altaAplicar.mjs. */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BIN_GIT } from '../../../shared/binarios.mjs';
import { baseDe } from '../cierre.mjs';
import {
  AGENTS_PROPIOS, CARPETAS_AGENTE, GITIGNORE, MANIFIESTOS, ROADMAP_PLANTILLA,
  comprobarRegistro, fallo, ok, omitida,
} from './altaReglas.mjs';

export function git(ruta, args) {
  return execFileSync(BIN_GIT, ['-C', ruta, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();
}

export function gitOk(ruta, args) {
  try {
    git(ruta, args);
    return true;
  } catch {
    return false;
  }
}

/* Subcarpetas que pueden tener un manifiesto propio (p. ej. `pulse/Cargo.toml` en glory-pulse).
 * [por que] Antes solo se miraba la raíz: glory-pulse salía «sin manifiesto» aunque su gate ya
 * compila `pulse/Cargo.toml` (falso positivo del alta). Se excluyen las que nunca son un stack del proyecto. */
const NO_STACK = new Set(['node_modules', 'target', 'dist', 'logs', 'docs', 'scripts', 'Agente']);
function subcarpetasDeStack(ruta) {
  try {
    return readdirSync(ruta, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !NO_STACK.has(d.name))
      .map((d) => join(ruta, d.name));
  } catch {
    return [];
  }
}

export function comprobarStack(ruta) {
  const dirs = [ruta, ...subcarpetasDeStack(ruta)];
  const stacks = [...new Set(dirs.flatMap((d) => MANIFIESTOS.filter(([f]) => existsSync(join(d, f))).map(([, s]) => s)))];
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

/* Mismas reglas que `hayEstilos` del tablero (`src/server/scanner/gate.ts`): extensiones de hoja
 * de estilo y configs de tailwind, ocultos fuera, y topes de profundidad y entradas. [por que]
 * Antes solo miraba `.css` hasta tres niveles: un proyecto con SCSS (o con tailwind config) salía
 * «sin CSS propio» en el alta, pero el tablero sí le exigía varsense. Las dos reglas son el mismo
 * concepto en dos runtimes; el test diferencial de `gate.test.ts` las compara sobre el mismo árbol. */
const EXTENSION_ESTILOS = /\.(css|scss|sass|less|styl|pcss)$/i;
const CONFIG_TAILWIND = /^tailwind\.config\.(js|cjs|mjs|ts)$/i;
const DIRECTORIOS_IGNORADOS = new Set(['node_modules', 'target', 'dist', 'build', 'out', 'coverage']);
const PROFUNDIDAD_MAX = 6;
const ENTRADAS_MAX = 5000;

export function hayCss(ruta) {
  let presupuesto = ENTRADAS_MAX;

  function recorrer(dir, profundidad) {
    /* Agotar profundidad o presupuesto asume que hay estilos: el alta no debe dar por bueno un
     * proyecto sin varsense solo porque no terminó de mirar (misma dirección segura que el tablero). */
    if (profundidad > PROFUNDIDAD_MAX) return true;
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const e of entradas) {
      if (--presupuesto < 0) return true;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || DIRECTORIOS_IGNORADOS.has(e.name)) continue;
        if (recorrer(join(dir, e.name), profundidad + 1)) return true;
      } else if (EXTENSION_ESTILOS.test(e.name) || CONFIG_TAILWIND.test(e.name)) {
        return true;
      }
    }
    return false;
  }

  return recorrer(ruta, 0);
}

export function comprobarVarsense(ruta) {
  if (!hayCss(ruta)) return omitida('varsense', 'sin estilos propios');
  if (existsSync(join(ruta, 'varsense.config.json'))) return ok('varsense', 'varsense.config.json');
  return fallo('varsense', 'hay estilos y falta varsense.config.json', 'configúralo con la skill varsense (AGENTS §9.3)');
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
