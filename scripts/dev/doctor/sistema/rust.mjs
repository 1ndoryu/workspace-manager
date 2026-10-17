/* Deteccion del taller Rust: manifiestos, target efectivo, sccache y binarios. */

import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve } from 'node:path';

import { RAIZ_REPO } from '../base.mjs';
import { normalizarRuta } from './procesos.mjs';
import { resolverExe } from './resolver.mjs';

/* Higiene Rust (05AA-2): avisa cuando un proyecto Rust del area esta mal
 * configurado en lo que 05AA-1 midio (target gigante, sin perfil adelgazado,
 * sin sccache util, target compartido). Solo lectura + aviso: jamas purga ni
 * reescribe nada. Fail-open: lo que no se puede medir se omite (nunca rompe
 * el doctor ni el --assert). Cada aviso degrada a exit 2 via codigoSalida.
 * [por que] Misma forma que detectarCompartidos: funcion pura sobre el
 * registro + lecturas; la consola y trampa ignoran el campo extra `rust`.
 * [por que] La entrada que no quiere esta higiene lo declara con
 * `"higieneRust": false` en el registro (antes se deducia por nombre: PROYECTO
 * TASKS quedo fuera por un roto de dependencia ajena E0753, no por higiene;
 * el caso se menciona solo como motivo, no como regla). */
const RUST_UMBRAL_BYTES = 2 * 1024 * 1024 * 1024;

const RUST_HIT_MIN = 5; // % (05AA-1: 0,89% era cache decorativa)

const RE_RUST = /cargo|run-with-db|dev-web\.mjs/i;


function esEntradaRust(e) {
  const texto = [...(e.boton ?? [])].map((a) => (a ?? []).join(' ')).join(' ') + ' ' + (e.tipoLauncher ?? '');
  return RE_RUST.test(texto);
}


function manifestRust(rutaAbs, entrada) {
  // [por que] El manifiesto a leer es el del `dev:back` real: pulse compila
  // con --manifest-path y el resto usa la raiz (el legacy
  // glory-rs/backend/Cargo.toml no se lee, caso 05AA-1).
  for (const argv of entrada.boton ?? []) {
    const i = (argv ?? []).indexOf('--manifest-path');
    if (i >= 0 && argv[i + 1]) {
      const c = resolve(rutaAbs, argv[i + 1]);
      if (existsSync(c)) return c;
    }
  }
  const raiz = join(rutaAbs, 'Cargo.toml');
  return existsSync(raiz) ? raiz : null;
}


function targetEfectivoRust(rutaAbs, envEntrada) {
  // [por que] Misma regla F0 de 05AA-1: env de la entrada > env de usuario >
  // in-tree. Solo dirs que existen (un wrapper por-rama que aun no compilo
  // no genera aviso fantasma). Limitacion honesta: subdirs por-rama del
  // wrapper se resuelven en runtime, aqui se mide lo que hay.
  const candidatos = [];
  if (typeof envEntrada.CARGO_TARGET_DIR === 'string' && envEntrada.CARGO_TARGET_DIR) {
    candidatos.push(envEntrada.CARGO_TARGET_DIR);
  }
  if (typeof process.env.CARGO_TARGET_DIR === 'string' && process.env.CARGO_TARGET_DIR) {
    candidatos.push(process.env.CARGO_TARGET_DIR);
  }
  candidatos.push(join(rutaAbs, 'target'));
  for (const c of candidatos) {
    const n = normalize(c);
    try {
      if (statSync(n).isDirectory()) return n;
    } catch {
      /* no existe: siguiente candidato. */
    }
  }
  return null;
}


function tamanoDirRust(ruta, tope = Infinity) {
  // [por que] Walk iterativo sin seguir symlinks: junctions dentro de
  // target/ con follow entrarian en bucle. Ficheros volatiles de una
  // compilacion en curso se omiten (mejor medir de menos que romper).
  // [por que] El tope corta en cuanto se supera el umbral: el aviso solo
  // decide "> umbral", y medir un target de 8 GB completo tardaba ~13 s y
  // hacia que el doctor (timeout 30 s en la vigilancia) fallara a ratos.
  let total = 0;
  const pila = [ruta];
  try {
    while (pila.length > 0) {
      const actual = pila.pop();
      let hijos;
      try {
        hijos = readdirSync(actual, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const h of hijos) {
        const p = join(actual, h.name);
        try {
          if (h.isSymbolicLink()) continue;
          if (h.isDirectory()) pila.push(p);
          else if (h.isFile()) total += statSync(p).size;
        } catch {
          /* volatil: se omite. */
        }
        if (total > tope) return total;
      }
    }
    return total;
  } catch {
    return null;
  }
}


function statsSccacheRust() {
  try {
    const sal = execFileSync('where.exe', ['sccache.exe'], { timeout: 10_000, windowsHide: true });
    const exe = String(sal)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && existsSync(l));
    if (!exe) return null;
    const txt = String(execFileSync(exe, ['--show-stats'], { timeout: 10_000, windowsHide: true }));
    const pet = /Compile requests\s+(\d+)/.exec(txt);
    const hit = /Cache hits rate\s+([\d.]+)\s*%/.exec(txt);
    if (!pet || !hit) return null;
    return { peticiones: Number(pet[1]), hit: Number(hit[1]) };
  } catch {
    return null;
  }
}


export function detectarRust(registro, opts = {}) {
  const umbral = opts.umbralBytes ?? RUST_UMBRAL_BYTES;
  const duenos = new Map(); // target normalizado -> [ids]
  const sinWrapper = [];
  const sinPerfil = [];
  try {
    const proyectos = [];
    for (const e of registro.entradas?.values() ?? []) {
      if (!esEntradaRust(e) || e.higieneRust === false) continue;
      // [por que 06AA-1] Sin ruta string no hay nada que medir (la marcada
      // con ruta rota se omite: fail-open documentado de esta higiene).
      if (typeof e.ruta !== 'string') continue;
      const rutaAbs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(RAIZ_REPO, e.ruta);
      proyectos.push({ id: e.id, rutaAbs, entrada: e, env: e.env && typeof e.env === 'object' ? e.env : {} });
    }
    // [por que] limpiador-pc es noAplica (sin boton) pero compila Rust: se
    // cubre fijo en vez de inventar boton en el registro. `incluirLimpiador`
    // solo existe para el fixture (evita que el limpiador real contamine).
    if (opts.incluirLimpiador ?? true) {
      const rutaLimp = resolve(RAIZ_REPO, '..', 'limpiador-pc');
      if (existsSync(join(rutaLimp, 'Cargo.toml')) && !proyectos.some((p) => p.id === 'limpiador-pc')) {
        proyectos.push({ id: 'limpiador-pc', rutaAbs: rutaLimp, entrada: { boton: [] }, env: {} });
      }
    }
    for (const p of proyectos) {
      const wrapper = p.env.RUSTC_WRAPPER ?? process.env.RUSTC_WRAPPER;
      if (!wrapper) sinWrapper.push(p.id);
      const man = manifestRust(p.rutaAbs, p.entrada);
      if (man) {
        try {
          const txt = readFileSync(man, 'utf8');
          if (!/^\s*\[profile\.dev\]/m.test(txt) || !/line-tables-only/.test(txt)) sinPerfil.push(p.id);
        } catch {
          /* manifiesto ilegible: se omite (fail-open). */
        }
      }
      const t = targetEfectivoRust(p.rutaAbs, p.env);
      if (t) {
        const clave = normalizarRuta(t);
        if (!duenos.has(clave)) duenos.set(clave, { ruta: t, ids: [] });
        duenos.get(clave).ids.push(p.id);
      }
    }
  } catch {
    return [];
  }
  const avisos = [];
  for (const id of [...sinWrapper].sort()) {
    avisos.push({ chequeo: 'cache', proyectos: [id], detalle: 'sin RUSTC_WRAPPER en entrada ni entorno (05AA-1)' });
  }
  for (const id of [...sinPerfil].sort()) {
    avisos.push({ chequeo: 'perfil', proyectos: [id], detalle: 'manifiesto sin [profile.dev] adelgazado (05AA-1)' });
  }
  if (sinWrapper.length === 0) {
    // [por que] Con wrapper presente pero hit bajo, la cache es decorativa
    // (caso 05AA-1: 0,89%). Sin stats medibles no se acusa: se omite.
    const st = opts.stats ?? statsSccacheRust();
    if (st && st.peticiones >= 10 && st.hit < RUST_HIT_MIN) {
      avisos.push({
        chequeo: 'cache',
        proyectos: [],
        detalle: `sccache con hit ${st.hit}% en ${st.peticiones} peticiones (<${RUST_HIT_MIN}%: decorativa)`,
      });
    }
  }
  for (const { ruta, ids } of [...duenos.values()].sort((a, b) => (a.ruta < b.ruta ? -1 : 1))) {
    const ordenados = [...ids].sort();
    if (ordenados.length > 1) {
      avisos.push({ chequeo: 'colision', proyectos: ordenados, detalle: `target/ compartido: ${ruta} (motivo para target/ por proyecto, 05AA-1 F5)` });
    }
    // [por que] Con tope, el valor es una cota inferior: el aviso solo cuenta
    // "> umbral", asi que no se mide el resto del arbol.
    const bytes = tamanoDirRust(ruta, umbral);
    if (bytes !== null && bytes > umbral) {
      avisos.push({
        chequeo: 'tamano',
        proyectos: ordenados,
        detalle: `target/ > ${(umbral / 1024 ** 3).toFixed(0)} GB (medido hasta el umbral): ${ruta}`,
      });
    }
  }
  return avisos.sort((a, b) => (a.chequeo < b.chequeo ? -1 : a.chequeo > b.chequeo ? 1 : a.proyectos.join().localeCompare(b.proyectos.join())));
}

/* Auto-reconstruccion del exe (06AA-1): si la entrada quedo marcada solo por
 * exe ausente (`_exeAusente`) y declara `reconstruir` valido, `up` recompila
 * con `cargo build --manifest-path` + CARGO_TARGET_DIR declarado antes de
 * arrancar, en vez de rehusar. Recompilar no toca procesos (el exe falta:
 * nada nuestro corre); el arranque posterior sigue las reglas normales
 * (si el puerto esta ocupado, rehusa). Sin shell: execFile directo; el build
 * loguea a logs/dev-up-<id>.log (mismo destino que lanzar). */

/* Cargo para `reconstruir`: el `cargo` de PATH puede ser un shim .cmd
 * (GlorySentinel) que CreateProcess no ejecuta directo; se prefieren los
 * cargo.exe reales conocidos y solo al final el resolver generico. */
async function resolverCargo() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const fijos = [
    join(home, '.cargo', 'bin', 'cargo.exe'),
    join(home, '.rustup', 'toolchains', 'stable-x86_64-pc-windows-msvc', 'bin', 'cargo.exe'),
  ];
  for (const c of fijos) {
    try {
      if (c && existsSync(c)) return c;
    } catch {
      /* Ruta inutil, se sigue. */
    }
  }
  return (await resolverExe('cargo')).exe;
}


export async function asegurarExe(id, entrada, rutaAbs) {
  if (!entrada._exeAusente) return null;
  if (existsSync(resolve(entrada._exeAusente))) {
    entrada._avisoRegistro = null;
    entrada._exeAusente = null;
    return null;
  }
  let cargo;
  try {
    cargo = await resolverCargo();
  } catch (e) {
    return `up ${id}: exe ausente y cargo irresoluble (${e.message}): reconstruir a mano`;
  }
  const dirLog = join(rutaAbs, 'logs');
  mkdirSync(dirLog, { recursive: true });
  const rutaLog = join(dirLog, `dev-up-${id}.log`);
  appendFileSync(rutaLog, `--- up ${new Date().toISOString()} :: reconstruir ${entrada._exeAusente}\n`);
  const hijo = await new Promise((res) => {
    const p = execFile(
      cargo,
      ['build', '--manifest-path', entrada._manifestAbs],
      {
        cwd: rutaAbs,
        timeout: 600_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, CARGO_TARGET_DIR: entrada._targetDirAbs },
      },
      (err, stdout, stderr) => res({ err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
    );
    void p;
  });
  appendFileSync(rutaLog, `${hijo.stdout.slice(-4000)}\n${hijo.stderr.slice(-4000)}\n`);
  if (hijo.err || !existsSync(resolve(entrada._exeAusente))) {
    const causa = hijo.err ? String(hijo.err.message ?? hijo.err).slice(0, 160) : 'exe sigue ausente tras compilar';
    return `up ${id}: reconstruccion fallo (${causa}, log ${rutaLog}): nada arrancado`;
  }
  entrada._avisoRegistro = null;
  entrada._exeAusente = null;
  return null;
}

