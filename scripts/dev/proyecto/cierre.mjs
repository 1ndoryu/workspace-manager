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
import { avisoTaller } from '../taller/taller-aviso.mjs';
import { rutaConfigPrivada } from '../../shared/rutas.mjs';
import { BIN_GIT } from '../../shared/binarios.mjs';
import { procesosSshVivos } from '../doctor/sistema/procesos.mjs';
import { tunelDeListener } from '../doctor/sistema/puertos.mjs';

/* Tablero y opencode-propio: nunca se cuentan como procesos propios del proyecto
 * (AGENTS §5 y §9.2). */
import { PUERTOS_PROTEGIDOS } from '../../shared/puertos.mjs';
export { PUERTOS_PROTEGIDOS };

const ok = (nombre, detalle) => ({ nombre, ok: true, detalle });
const fallo = (nombre, detalle, accion, lineas = []) => ({ nombre, ok: false, detalle, accion, lineas });
const omitida = (nombre, motivo) => ({ nombre, ok: true, detalle: `omitida: ${motivo}` });

function git(ruta, args) {
  return execFileSync(BIN_GIT, ['-C', ruta, ...args], {
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
    // [por que] symbolic-ref devuelve `origin/<rama>`; la comparación con la rama local necesita el nombre sin prefijo.
    return git(ruta, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '');
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

/* La tarea se indica con --tarea: si sigue como tarea abierta en roadmap.md, el
 * cierre no está listo. Sin --tarea se omite: el roadmap del proyecto puede tener
 * otras tareas abiertas ajenas a esta sesión.
 * [por que] Se mira solo la LINEA DE TAREA, no cualquier mención: la forma canonica
 * (D8) es `- [ ] \`ID\` — **Titulo.**`, y las formas viejas (ID al principio de un
 * bullet o de un heading) siguen reconociéndose para no dar un falso verde —MN
 * escribe el ID en negrita (nota 19AA-3 del roadmap)—. Una mención en prosa
 * («depende de \`17AA-2\`») o un enlace a un plan no cuenta. */
const escaparId = (id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE_TAREA = (id) =>
  new RegExp(`^\\s*(?:[-*]\\s+\\[ \\]|\\d+\\.|[-*]\\s+|#{2,4}\\s+)\\s*(?:\`${escaparId(id)}\`|\\*\\*${escaparId(id)}\\b)`);
/* Marcas de tarea cerrada: la casilla marcada, el tachado y el visto bueno. El visto bueno va
 * como escape Unicode y no como emoji literal: la regla `emoji-en-codigo` de Sentinel lo prohibe.
 * [por que] NO se buscan las palabras «hecho»/«cerrado»: en la forma canonica el titulo puede
 * llevarlas sin que la tarea este cerrada («PENDIENTE DE HECHO EXTERNO», «Criterio de hecho:
 * ...») y el cierre daba un falso verde. Un falso «abierta» es la direccion segura; un falso
 * «cerrada» deja cerrar trabajo vivo. */
const RE_HECHA = /\[x\]|~~|\u2705/;

/* Secciones que son zona de tareas: las mismas que reconoce el parser del tablero
 * (`src/server/scanner/roadmap/roadmap.ts`, D8). [por que] Fuera de ellas un bullet con ID es
 * una mención, no una tarea: en «Bloqueos» y «Planes activos» los IDs van como referencia y el
 * cierre daba un falso «sigue abierta» (22 casos medidos el 2026-10-19). Los `.mjs` sueltos no
 * pueden importar el `.ts`, así que el gemelo se mantiene a mano (17AA-5). */
const RE_ZONA_TAREAS =
  /^(?:siguiente bloque|bloque actual|ahora|(?:tareas? )?pendientes?|backlog|tareas?|por hacer|cola|desarrollo pendiente)/;

/* Lineas que pueden contener una tarea abierta: las de una seccion de tareas, al primer nivel, y
 * cualquier casilla fuera de «Planes activos». [por que] La casilla es la forma canonica de una
 * tarea, este donde este: si alguien la deja bajo «Bloqueos», sigue siendo trabajo abierto y darla
 * por cerrada seria un falso verde (la direccion peligrosa). La exclusion por zona vale para
 * menciones SIN casilla, que es el caso de los 22 falsos «sigue abierta» medidos el 2026-10-19.
 * [por que se normaliza como el parser] `\r?\n` y sin espacios finales: con ficheros CRLF el `$`
 * de los regex no casaba y el cierre no veia NINGUNA tarea abierta (falso verde medido en
 * glory-harness-19aa el 2026-10-19). */
function lineasDeTarea(texto) {
  const salida = [];
  let enTareas = false;
  let enPlanes = false;
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.replace(/\s+$/, '');
    const h = linea.match(/^(#{2,4})\s+(.+)$/);
    if (h) {
      if (h[1].length === 2) {
        const n = h[2]
          .replace(/^\s*\d+[.)]\s*/, '')
          .replace(/[^\p{L}\p{N} ]+/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        enTareas = RE_ZONA_TAREAS.test(n);
        /* Planes activos lista rutas de plan, no tareas: el parser del tablero ignora sus
         * lineas aunque lleven casilla, y el cierre tiene que ver lo mismo. */
        enPlanes = /^planes? activos?\b/.test(n);
      }
      /* Un heading dentro de la zona con el ID es una tarea escrita como heading. */
      if (enTareas) salida.push(linea);
      continue;
    }
    /* Sub-pasos sangrados de una tarea: no son tareas (igual que el parser). */
    if (/^\s+\S/.test(linea)) continue;
    if (enTareas || (!enPlanes && /^[-*]\s+\[[ xX]\]/.test(linea))) salida.push(linea);
  }
  return salida;
}

export function comprobarRoadmap(ruta, tarea) {
  if (!tarea) return omitida('roadmap-tarea', 'sin --tarea <ID>');
  const archivo = join(ruta, 'roadmap.md');
  if (!existsSync(archivo)) return omitida('roadmap-tarea', 'sin roadmap.md');
  const re = RE_TAREA(tarea);
  const abiertas = lineasDeTarea(readFileSync(archivo, 'utf8')).filter(
    (l) => re.test(l) && !RE_HECHA.test(l),
  );
  if (abiertas.length === 0) return ok('roadmap-tarea', `${tarea} no está abierta en roadmap.md`);
  return fallo(
    'roadmap-tarea',
    `${tarea} sigue abierta en roadmap.md`,
    'quítala del roadmap al cerrar y regístrala en Agente/completados (AGENTS §9)',
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

/* `aceptados` = { puertos, motivo } del registro: procesos que la usuaria decidió mantener.
 * `entrada` = la ficha del proyecto: su túnel ssh gestionado por Arranque no es un dev server.
 * `procesosSsh` se inyecta en las pruebas (por defecto, los ssh vivos del sistema).
 * [por que] Se listan en el detalle, no se ocultan: la excepción queda visible en cada cierre. */
export async function comprobarProcesos(puertos = [], aceptados = null, entrada = null, procesosSsh = procesosSshVivos) {
  const propios = puertos.filter((p) => !PUERTOS_PROTEGIDOS.includes(p));
  const excepcion = aceptados?.puertos ?? [];
  const excluidos = propios.filter((p) => excepcion.includes(p));
  const escuchando = [];
  for (const p of propios) {
    if (excepcion.includes(p)) continue;
    if (await escucha(p)) escuchando.push(p);
  }
  // [por que] El túnel que abre `Arranque up` escucha en el puerto local del proyecto: es el mando, no un proceso huérfano.
  const sshVivos = escuchando.length && entrada ? await procesosSsh() : [];
  const tuneles = escuchando.filter((p) => tunelDeListener(p, sshVivos, [entrada]) !== null);
  const vivos = escuchando.filter((p) => !tuneles.includes(p));
  const nota = [
    excluidos.length ? `excepción aceptada: ${excluidos.join(', ')} — ${aceptados.motivo}` : '',
    tuneles.length ? `túnel gestionado: ${tuneles.join(', ')}` : '',
  ].filter(Boolean);
  const sufijo = nota.length ? ` (${nota.join('; ')})` : '';
  if (vivos.length === 0) return ok('procesos-propios', `ningún puerto propio escuchando${sufijo}`);
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
    return fallo('gate-cierre', e?.message ?? String(e), 'arranca el tablero: Arranque up "<id del manager>"');
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
    const registro = JSON.parse(readFileSync(rutaConfigPrivada('registro.json', raiz), 'utf8'));
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
    checks.push(await comprobarProcesos(entrada.puertos, entrada.procesosAceptados, entrada));
    checks.push(await comprobarGate(id));

    for (const c of checks) {
      console.log(`${c.ok ? '✓' : '✗'} ${c.nombre} — ${c.detalle}`);
      if (!c.ok && c.accion) console.log(`    → ${c.accion}`);
      for (const l of c.lineas ?? []) console.log(`      ${l}`);
    }
    const pendientes = checks.filter((c) => !c.ok).length;
    // [por que 14AA-5] El aviso del taller va antes del veredicto y no lo altera.
    await avisoTaller();
    console.log(pendientes === 0 ? `cierre ${id}: listo` : `cierre ${id}: NO listo (${pendientes} pendiente(s))`);
    return pendientes === 0 ? 0 : 1;
  } catch (e) {
    console.error(`cierre ${id}: ${e?.message ?? e}`);
    return 1;
  }
}
