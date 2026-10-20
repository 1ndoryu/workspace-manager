#!/usr/bin/env node
// Taller remoto (VPS 89): este script SIEMPRE ejecuta cargo en la 89.
// Sync laptop→89 con Mutagen (réplica unidireccional, sin commit ni GitHub).
// Diseño y decisiones: Agente/planes/plan-taller-remoto-vps89-fase-2-2026-10-14.md
//
// Uso: node rcargo.mjs [--proyecto=NOMBRE] [--dry-run] <args de cargo>
// El modo local (cargo en el laptop, solo con --local) no vive aquí: lo decide el
// wrapper del proyecto (scripts/run-cargo.mjs) con modoEfectivo(). Usa ese wrapper.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigirConfigPrivada } from '../shared/rutas.mjs';
import { BIN_GIT, BIN_SSH } from '../shared/binarios.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MODOS = new Set(['local', 'remoto']);

export function cargarConfig(ruta = exigirConfigPrivada('taller.json')) {
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

// Precedencia: flag (--local/--remoto) > variable TALLER_MODO > proyectos.<nombre>.modo > modoPorDefecto.
export function modoEfectivo(argv, config, proyecto, env = process.env) {
  if (argv.includes('--local')) return 'local';
  if (argv.includes('--remoto')) return 'remoto';
  if (MODOS.has(env.TALLER_MODO)) return env.TALLER_MODO;
  const porProyecto = config.proyectos?.[proyecto]?.modo;
  if (MODOS.has(porProyecto)) return porProyecto;
  return config.modoPorDefecto;
}

// Quita los flags del taller para que no lleguen a cargo.
export function quitarFlagsTaller(argv) {
  return argv.filter(
    (a) => !['--local', '--remoto', '--dry-run'].includes(a)
      && !a.startsWith('--proyecto=')
      && !a.startsWith('--env=')
      && !a.startsWith('--prepath='),
  );
}

/* Entorno extra para un cargo concreto: `--env=K=V` y `--prepath=<dir>` (repetibles, forma con `=`
 * para que `quitarFlagsTaller` los reconozca). [por que] Un build cruzado a Windows necesita cosas
 * que no están ni en el PATH de un ssh no interactivo ni en el entorno del taller: el llvm de
 * lld-link (`--prepath`), el zip de Swagger UI (`utoipa-swagger-ui` lo baja en build.rs) y RUSTFLAGS.
 * Sin esto cada proyecto abría su propio `ssh … cargo` fuera de `cm-heavy` y con target propio
 * (caso real 2026-10-19: PROYECTO TASKS; `cm-sweep` barrió el build a medias). */
export function entornoExtra(argv) {
  const pares = [];
  for (const a of argv) {
    if (a.startsWith('--env=')) {
      const par = a.slice('--env='.length);
      if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(par)) {
        throw new Error(`--env espera NOMBRE=valor, no «${par}»`);
      }
      // Solo el valor va entrecomillado: `'NOMBRE=valor'` entero sería un comando, no una asignación.
      const corte = par.indexOf('=');
      pares.push(`${par.slice(0, corte)}=${shQuote(par.slice(corte + 1))}`);
    } else if (a.startsWith('--prepath=')) {
      // Sin comillas alrededor de "$PATH": se quiere la expansión del shell remoto.
      pares.push(`PATH=${shQuote(a.slice('--prepath='.length))}:"$PATH"`);
    }
  }
  return pares;
}

export function shQuote(valor) {
  return `'${String(valor).replace(/'/g, `'\\''`)}'`;
}

// [por que] El .cargo/config.toml de un proyecto puede fijar `build.rustc-wrapper` a un binario de
// Windows (WANDORIUS lo hace con sccache): en la 89 no existe y el build muere con «could not execute
// process .../sccache.exe (os error 2)». El entorno manda sobre el fichero, así que se limpia en todo
// lo que compile o arranque en la 89. Fuente única: scripts/dev/remoto.mjs la importa de aquí.
export const SIN_RUSTC_WRAPPER = 'RUSTC_WRAPPER= ';

// Nombre de rama → slug para el directorio de target (minúsculas, [a-z0-9-]).
export function slug(rama) {
  return String(rama).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'main';
}

/* [por que] Mutagen rechaza los nombres de sesión con espacios («invalid session name:
 * invalid name character at index 15: ' '») y los ids del taller los llevan («PROYECTO TASKS»),
 * así que un proyecto con espacio en el nombre no se podía subir. Se normaliza a [A-Za-z0-9._-].
 * Los ids normales (p. ej. `mi-proyecto`) no cambian. Misma regla, en TypeScript, en
 * src/shared/taller/sesiones.ts: al tocar una, tocar la otra. */
export function slugSesion(valor) {
  return String(valor).replace(/[^A-Za-z0-9._-]+/g, '-');
}

export function nombreSesion(proyecto) {
  return `taller-${slugSesion(proyecto)}`;
}

// [por que] Los logs viven fuera de dirRemoto: Mutagen (one-way-replica) borra en la 89 lo que no existe en el laptop, y dentro de la réplica se perdían.
export function rutasRemotas(config, proyecto, rama) {
  return {
    dirRemoto: `${config.dirRemotoBase}/${proyecto}`,
    dirLogs: `${config.dirRemotoBase}/_logs/${proyecto}`,
    target: `${config.targetBase}/${proyecto}_${slug(rama)}`,
  };
}

// Argumentos de `mutagen sync create`. Réplica laptop→89: la VPS nunca escribe de vuelta.
export function argsCrearSesion(config, proyecto, rutaLocal) {
  const ignorar = config.sync.ignorar.flatMap((p) => ['--ignore', p]);
  return [
    'sync', 'create',
    '--name', nombreSesion(proyecto),
    '--mode', config.sync.modo,
    ...ignorar,
    rutaLocal,
    `${config.host}:${config.dirRemotoBase}/${proyecto}`,
  ];
}

// Base de datos por rama, como scripts/branch-db.mjs: {paquete}_{rama}; main/master usan {paquete}.
// [14AA-1] Solo la necesitan los subcomandos de taller.json `bd.subcomandos`. La 89 no tiene .git
// (Mutagen no lo sincroniza), por eso el nombre se calcula aquí y no con branch-db.mjs.
// [por que] `base` (taller.json `proyectos.<nombre>.basedatos`) pisa al paquete: proyectos del
// mismo template (p. ej. glory-backend) comparten `[package].name` y, sin él, colisionan en la 89.
export function nombreBaseDatos(cargoToml, rama, base = null) {
  let paquete = base;
  if (!paquete) {
    // Solo la sección [package]: un `name` de [[bin]] o [lib] no es el paquete.
    const seccion = cargoToml.split(/^\[/m).find((s) => s.startsWith('package]'));
    const m = seccion?.match(/^name\s*=\s*"([^"]+)"/m);
    if (!m) throw new Error('Cargo.toml de la raíz sin [package].name: no se puede derivar la base de datos');
    paquete = m[1].replace(/-/g, '_');
  }
  const defecto = rama === 'main' || rama === 'master';
  const nombre = (defecto ? paquete : `${paquete}_${String(rama).replace(/[^a-zA-Z0-9]/g, '_')}`).toLowerCase();
  if (nombre.length > 63 || !/^[a-z0-9_]+$/.test(nombre)) {
    throw new Error(`nombre de base de datos no válido o demasiado largo: ${nombre}`);
  }
  return nombre;
}

// [por que] Sin contraseña: el rol dev entra por el socket Unix (peer), igual que el resto de la 89.
export function urlBaseRemota(bd, nombre) {
  return `postgres://${bd.usuario}@${encodeURIComponent(bd.socket)}/${nombre}`;
}

// Crea la base si falta (idempotente). Va entre paréntesis: si `cd` falla, no se crea nada.
export function comandoBaseRemota(bd, nombre) {
  const psql = (sql) =>
    `psql -h ${shQuote(bd.socket)} -U ${shQuote(bd.usuario)} -d postgres -v ON_ERROR_STOP=1 -qtAc ${shQuote(sql)}`;
  return `( ${psql(`SELECT 1 FROM pg_database WHERE datname='${nombre}'`)} | grep -qx 1 || ${psql(`CREATE DATABASE "${nombre}"`)} )`;
}

// [16AA-9 F3] La base de rama se creaba vacía y los tests de base viva
// fallaban con «no existe la relación …»; en el portátil lo cubría
// `scripts/run-with-db.mjs` (migrar + sembrar), pero ese camino compila en el
// portátil y AGENTS §1 lo prohíbe. Aquí se clona el esquema de la base de
// trabajo (ya migrada y sincronizada por `Arranque up`) y se aplica la semilla
// que declare el proyecto (`taller.json` `proyectos.<id>.bdRama.semilla`).
// Solo si la base de rama está vacía: si ya tiene tablas, manda lo que hay.
export function comandoPrepararRama(bd, nombre, base, semilla = null) {
  const psql = (db, extra) => `psql -h ${shQuote(bd.socket)} -U ${shQuote(bd.usuario)} -d ${shQuote(db)} -v ON_ERROR_STOP=1 -q ${extra}`;
  const tablas = "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'";
  const vacia = `[ "$(${psql(nombre, `-qtAc ${shQuote(tablas)}`)})" = 0 ]`;
  const clon = `pg_dump -h ${shQuote(bd.socket)} -U ${shQuote(bd.usuario)} --schema-only --no-owner --no-acl ${shQuote(base)} | ${psql(nombre, '-f -')}`;
  const pasos = [clon, ...(semilla ? [psql(nombre, `-f ${shQuote(semilla)}`)] : [])].join(' && ');
  return `if ${vacia}; then ${pasos}; fi`;
}

// Comando que ssh ejecuta en la VPS. El lock de carga pesada (cm-heavy) va delante de cargo.
// `preparar` ({base, semilla}) es opcional: solo lo usa la base de rama.
export function construirComandoRemoto(config, rutas, args, nombreBd = null, preparar = null, extra = []) {
  const entorno = [
    SIN_RUSTC_WRAPPER,
    ...(nombreBd ? [`DATABASE_URL=${shQuote(urlBaseRemota(config.bd, nombreBd))}`] : []),
    `CARGO_TARGET_DIR=${shQuote(rutas.target)}`,
    ...extra,
  ].join(' ');
  const interno = [
    `cd ${shQuote(rutas.dirRemoto)}`,
    ...(nombreBd ? [comandoBaseRemota(config.bd, nombreBd)] : []),
    ...(nombreBd && preparar ? [comandoPrepararRama(config.bd, nombreBd, preparar.base, preparar.semilla)] : []),
    `${entorno} ${config.lockWrapper} cargo ${args.map(shQuote).join(' ')}`,
  ].join(' && ');
  return ['bash', '-lc', shQuote(interno)];
}

// [por que] Sin ControlMaster/ControlPersist: el OpenSSH de Windows no abre el maestro
// ("Failed to connect to new control master", 2026-10-14). Cada comando abre su conexion.
export function argsSsh(config, comandoRemoto) {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    config.host,
    ...comandoRemoto,
  ];
}

function git(cwd, args) {
  const r = spawnSync(BIN_GIT, args, { cwd, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function detectarProyecto(cwd) {
  const raiz = git(cwd, ['rev-parse', '--show-toplevel']);
  return path.basename(raiz ?? cwd);
}

export function detectarRama(cwd) {
  return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'main';
}

function mostrar(cmd, args) {
  return [cmd, ...args].map((a) => (/\s|'/.test(a) ? shQuote(a) : a)).join(' ');
}

function correr(cmd, args, { dryRun, cwd, heredar = false, silencioso = false }) {
  if (dryRun) {
    console.log(mostrar(cmd, args));
    return { status: 0 };
  }
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: heredar ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) {
    console.error(`rcargo: no se pudo ejecutar "${cmd}": ${r.error.message}`);
    return { status: 2 };
  }
  if (r.status !== 0 && !heredar && !silencioso) {
    process.stderr.write(r.stderr ?? '');
    process.stdout.write(r.stdout ?? '');
  }
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

// La base se deriva de la raíz del repo, igual que el directorio remoto (dirRemoto).
function leerCargoToml(cwd) {
  const raiz = git(cwd, ['rev-parse', '--show-toplevel']) ?? cwd;
  return readFileSync(path.join(raiz, 'Cargo.toml'), 'utf8');
}

// Deja la réplica lista: crea el directorio y la sesión si faltan, y fuerza el envío pendiente.
// Código 0 si el árbol de la VPS coincide con el laptop; 2 si no se pudo ejecutar mutagen; 1 en otro fallo.
// [por que] `up` escribía .env en un directorio que aún no existía y no esperaba el envío inicial: npm ci y precompilar podían leer un árbol a medias.
export function asegurarSesion({ config, proyecto, rutaLocal, rutas, dryRun = false, cwd = rutaLocal }) {
  const mutagen = config.sync?.binario || 'mutagen';
  const sesion = nombreSesion(proyecto);
  // [14AA-1] `sync list` sale con 1 si no existe la sesión (stderr); ese 1 no es un fallo, es la señal de crearla.
  const lista = correr(mutagen, ['sync', 'list', sesion], { dryRun, cwd, silencioso: true });
  if (lista.status === 2) return 2;
  if (dryRun || lista.status !== 0) {
    if (correr(BIN_SSH, argsSsh(config, ['mkdir', '-p', rutas.dirRemoto, rutas.target]), { dryRun, cwd }).status !== 0) return 1;
    if (correr(mutagen, argsCrearSesion(config, proyecto, rutaLocal), { dryRun, cwd }).status !== 0) return 1;
  }
  return correr(mutagen, ['sync', 'flush', sesion], { dryRun, cwd }).status === 0 ? 0 : 1;
}

// [por que] Mutagen corre en el laptop (Windows). Si rcargo se lanza desde la propia 89, el árbol
// ya es la réplica y no hay binario de sync: `spawnSync` fallaba con ENOENT en la ruta de Windows.
export function esVps(plataforma = process.platform) {
  return plataforma !== 'win32';
}

// [por que] La réplica laptop→89 borra en la 89 cualquier archivo que no exista en el laptop, así que un
// Cargo.lock generado allí desaparece en ~25 s y cada build resuelve dependencias de nuevo. Se avisa, no se bloquea.
export function avisoCargoLock(raiz, existe = existsSync) {
  if (!existe(path.join(raiz, 'Cargo.toml')) || existe(path.join(raiz, 'Cargo.lock'))) return null;
  return 'rcargo: aviso: hay Cargo.toml sin Cargo.lock en el laptop. La 89 lo borraría al sincronizar; versiona Cargo.lock en el laptop (Agente/documentacion/alta-proyectos-2026-10-11.md).';
}

// Asegura la sesión de Mutagen, fuerza el envío pendiente y ejecuta cargo en la VPS.
export function ejecutarRemoto({ config, proyecto, rama, cwd, args, dryRun, extra = [] }) {
  const rutas = rutasRemotas(config, proyecto, rama);
  // [14AA-1] Antes de sincronizar: si no se puede derivar el nombre, no se lanza nada.
  let nombreBd = null;
  let preparar = null;
  if (config.bd?.subcomandos?.includes(args[0])) {
    try {
      const basedatos = config.proyectos?.[proyecto]?.basedatos;
      const cargoToml = leerCargoToml(cwd);
      nombreBd = nombreBaseDatos(cargoToml, rama, basedatos);
      const base = nombreBaseDatos(cargoToml, 'main', basedatos);
      // [16AA-9 F3] Solo la base de rama: la base de trabajo la mantiene `Arranque up`.
      if (nombreBd !== base) preparar = { base, semilla: config.proyectos?.[proyecto]?.bdRama?.semilla ?? null };
    } catch (e) {
      console.error(`rcargo: ${e.message}`);
      return 2;
    }
  }

  if (!esVps()) {
    const aviso = avisoCargoLock(git(cwd, ['rev-parse', '--show-toplevel']) ?? cwd);
    if (aviso) console.error(aviso);
    const sync = asegurarSesion({ config, proyecto, rutaLocal: cwd, rutas, dryRun, cwd });
    if (sync !== 0) return sync;
  }

  const remoto = construirComandoRemoto(config, rutas, args, nombreBd, preparar, extra);
  return correr(BIN_SSH, argsSsh(config, remoto), { dryRun, cwd, heredar: true }).status;
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const cwd = process.cwd();
  const config = cargarConfig();
  const opcion = argv.find((a) => a.startsWith('--proyecto='));
  const proyecto = opcion ? opcion.split('=')[1] : detectarProyecto(cwd);
  const args = quitarFlagsTaller(argv);

  if (args.length === 0) {
    console.error('rcargo: falta el subcomando de cargo (p. ej. check, test, build).');
    return 64;
  }
  let extra;
  try {
    extra = entornoExtra(argv);
  } catch (e) {
    console.error(`rcargo: ${e.message}`);
    return 64;
  }
  return ejecutarRemoto({ config, proyecto, rama: detectarRama(cwd), cwd, args, dryRun, extra });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
