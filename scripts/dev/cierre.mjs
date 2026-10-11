/* Puerta de cierre de una tarea (10AA-2 F9.6). Solo lee: no toca el proyecto.
 *   cierre <id> [--tarea <ID>]   imprime ✓/✗ por comprobación; exit 0 solo si todas pasan.
 * [por que] AGENTS §8 listaba seis pasos que se olvidaban uno a uno. Aquí quedan
 * en una salida fija y el exit code sirve de puerta. Cada comprobación devuelve
 * {nombre, ok, detalle, accion?, lineas?}; `omitida` cuenta como ok con motivo. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { RAIZ, formatearNuevos, pedir, rutaSnapshot } from './gate.mjs';

/* Tablero y opencode-propio: nunca se cuentan como procesos propios del proyecto
 * (AGENTS §5 y §9.2). */
export const PUERTOS_PROTEGIDOS = [5174, 5175, 8787];

const ok = (nombre, detalle) => ({ nombre, ok: true, detalle });
const fallo = (nombre, detalle, accion, lineas = []) => ({ nombre, ok: false, detalle, accion, lineas });
const omitida = (nombre, motivo) => ({ nombre, ok: true, detalle: `omitida: ${motivo}` });

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

/* Base de integración: `main` local si existe; si no, la rama por defecto del remoto.
 * [por que] Integrar siempre en `main` es la regla de AGENTS §5; el remoto solo
 * sirve de respaldo para repos que no tienen `main` local. */
export function baseDe(ruta) {
  if (gitOk(ruta, ['rev-parse', '--verify', '-q', 'main'])) return 'main';
  try {
    return git(ruta, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  } catch {
    return null;
  }
}

export function comprobarArbol(ruta) {
  const cambios = git(ruta, ['status', '--porcelain']).split('\n').filter(Boolean);
  if (cambios.length === 0) return ok('arbol-limpio', 'sin cambios sin commit');
  return fallo(
    'arbol-limpio',
    `${cambios.length} cambios sin commit`,
    'commitea tus archivos por nombre; los cambios ajenos no se tocan (AGENTS §5)',
    cambios.slice(0, 10),
  );
}

export function comprobarIntegrada(ruta, base) {
  if (gitOk(ruta, ['merge-base', '--is-ancestor', 'HEAD', base])) {
    return ok('rama-integrada', `HEAD está en ${base}`);
  }
  return fallo('rama-integrada', `HEAD no está en ${base}`, `integra en ${base} y empuja ${base} (AGENTS §5)`);
}

export function comprobarRamasSueltas(ruta, base) {
  const sueltas = git(ruta, ['branch', '--no-merged', base, '--format=%(refname:short)'])
    .split('\n')
    .filter(Boolean);
  if (sueltas.length === 0) return ok('ramas-sueltas', `ninguna sin integrar frente a ${base}`);
  return fallo(
    'ramas-sueltas',
    `${sueltas.length} sin integrar frente a ${base}`,
    'integra o borra cada rama (AGENTS §5); si la retienes, anótala en el roadmap',
    sueltas,
  );
}

/* La tarea se indica con --tarea: si su línea de roadmap.md sigue abierta
 * (**ACTIVA o **EN CURSO), el cierre no está listo. Sin --tarea se omite: el
 * roadmap del proyecto puede tener otras tareas abiertas ajenas a esta sesión.
 * [por que] Buscar el ID entre comillas invertidas evita que 11AA-1 coincida con 11AA-10. */
const MARCAS_ABIERTAS = ['**ACTIVA', '**EN CURSO'];

export function comprobarRoadmap(ruta, tarea) {
  if (!tarea) return omitida('roadmap-tarea', 'sin --tarea <ID>');
  const archivo = join(ruta, 'roadmap.md');
  if (!existsSync(archivo)) return omitida('roadmap-tarea', 'sin roadmap.md');
  const lineas = readFileSync(archivo, 'utf8').split('\n').filter((l) => l.includes(`\`${tarea}\``));
  if (lineas.length === 0) return ok('roadmap-tarea', `${tarea} no aparece en roadmap.md`);
  const abiertas = lineas.filter((l) => MARCAS_ABIERTAS.some((m) => l.includes(m)));
  if (abiertas.length === 0) return ok('roadmap-tarea', `${tarea} sin marca abierta`);
  return fallo(
    'roadmap-tarea',
    `${tarea} sigue abierta en roadmap.md`,
    'quítala del roadmap al cerrar y regístrala en Agente/completados (AGENTS §7.2)',
    abiertas.map((l) => l.trim().slice(0, 120)),
  );
}

function escucha(puerto) {
  return new Promise((resolver) => {
    const s = net.connect({ host: '127.0.0.1', port: puerto, timeout: 300 });
    s.once('connect', () => {
      s.destroy();
      resolver(true);
    });
    s.once('timeout', () => {
      s.destroy();
      resolver(false);
    });
    s.once('error', () => resolver(false));
  });
}

export async function comprobarProcesos(puertos = []) {
  const propios = puertos.filter((p) => !PUERTOS_PROTEGIDOS.includes(p));
  const vivos = [];
  for (const p of propios) {
    if (await escucha(p)) vivos.push(p);
  }
  if (vivos.length === 0) return ok('procesos-propios', 'ningún puerto propio escuchando');
  return fallo(
    'procesos-propios',
    `escuchan: ${vivos.join(', ')}`,
    'para tu dev server; confirma PID y línea de comando antes (AGENTS §5)',
  );
}

/* Compara los hallazgos actuales con el snapshot de `gate --inicio`. */
export async function comprobarGate(id) {
  const ruta = rutaSnapshot(id);
  if (!existsSync(ruta)) {
    return fallo('gate-cierre', 'sin línea base de esta tarea', `Arranque gate "${id}" --inicio, al empezar`);
  }
  try {
    const base = JSON.parse(readFileSync(ruta, 'utf8'));
    const r = await pedir('POST', '/api/gate/comparar', { clave: id, base: base.hallazgos });
    if (r.nuevos.length === 0) return ok('gate-cierre', `0 nuevos, ${r.resueltos} resueltos`);
    return fallo(
      'gate-cierre',
      `${r.nuevos.length} hallazgos nuevos`,
      'corrígelos en los archivos que tocaste (AGENTS §6)',
      formatearNuevos(r.nuevos),
    );
  } catch (e) {
    if (/no usa sentinel/.test(e?.message ?? '')) return omitida('gate-cierre', 'proyecto sin sentinel');
    return fallo('gate-cierre', e?.message ?? String(e), 'arranca el tablero: Arranque up "workspace-manager"');
  }
}

export async function cierre(argv, raiz = RAIZ) {
  const [id, ...resto] = argv;
  const iTarea = resto.indexOf('--tarea');
  const tarea = iTarea >= 0 ? resto[iTarea + 1] : undefined;
  if (!id || id.startsWith('--') || (iTarea >= 0 && (!tarea || tarea.startsWith('--')))) {
    console.error('uso: cierre <id> [--tarea <ID>]');
    return 1;
  }
  try {
    const registro = JSON.parse(readFileSync(join(raiz, 'scripts', 'dev', 'registro.json'), 'utf8'));
    const entrada = registro.proyectos.find((x) => x.id === id);
    if (!entrada) {
      console.error(`cierre: '${id}' no está en registro.json`);
      return 1;
    }
    const ruta = resolve(raiz, entrada.ruta);
    const esGit = existsSync(ruta) && gitOk(ruta, ['rev-parse', '--is-inside-work-tree']);
    const base = esGit ? baseDe(ruta) : null;

    const checks = [];
    if (esGit) {
      checks.push(comprobarArbol(ruta));
      if (base) {
        checks.push(comprobarIntegrada(ruta, base));
        checks.push(comprobarRamasSueltas(ruta, base));
      } else {
        checks.push(omitida('rama-integrada', 'sin main ni origin/HEAD'));
        checks.push(omitida('ramas-sueltas', 'sin main ni origin/HEAD'));
      }
    } else {
      checks.push(omitida('arbol-limpio', 'sin Git'));
      checks.push(omitida('rama-integrada', 'sin Git'));
      checks.push(omitida('ramas-sueltas', 'sin Git'));
    }
    checks.push(comprobarRoadmap(ruta, tarea));
    checks.push(await comprobarProcesos(entrada.puertos));
    checks.push(await comprobarGate(id));

    for (const c of checks) {
      console.log(`${c.ok ? '✓' : '✗'} ${c.nombre} — ${c.detalle}`);
      if (!c.ok && c.accion) console.log(`    → ${c.accion}`);
      for (const l of c.lineas ?? []) console.log(`      ${l}`);
    }
    const pendientes = checks.filter((c) => !c.ok).length;
    console.log(pendientes === 0 ? `cierre ${id}: listo` : `cierre ${id}: NO listo (${pendientes} pendiente(s))`);
    return pendientes === 0 ? 0 : 1;
  } catch (e) {
    console.error(`cierre ${id}: ${e?.message ?? e}`);
    return 1;
  }
}
