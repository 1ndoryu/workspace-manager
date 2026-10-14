#!/usr/bin/env node
// Taller remoto (VPS 89): cargo se ejecuta en la VPS por defecto.
// Sync laptop→89 con Mutagen (réplica unidireccional, sin commit ni GitHub).
// Diseño y decisiones: Agente/planes/plan-taller-remoto-vps89-2026-10-14.md
//
// Uso: node rcargo.mjs [--proyecto=NOMBRE] [--dry-run] <args de cargo>
// Modo local (sin VPS): lo decide el wrapper del proyecto con modoEfectivo().

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MODOS = new Set(['local', 'remoto']);

export function cargarConfig(ruta = path.join(DIR, 'taller.json')) {
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
  return argv.filter((a) => !['--local', '--remoto', '--dry-run'].includes(a) && !a.startsWith('--proyecto='));
}

export function shQuote(valor) {
  return `'${String(valor).replace(/'/g, `'\\''`)}'`;
}

// Nombre de rama → slug para el directorio de target (minúsculas, [a-z0-9-]).
export function slug(rama) {
  return String(rama).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'main';
}

export function nombreSesion(proyecto) {
  return `taller-${proyecto}`;
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

// Comando que ssh ejecuta en la VPS. El lock de carga pesada (cm-heavy) va delante de cargo.
export function construirComandoRemoto(config, rutas, args, nombreBd = null) {
  const entorno = [
    ...(nombreBd ? [`DATABASE_URL=${shQuote(urlBaseRemota(config.bd, nombreBd))}`] : []),
    `CARGO_TARGET_DIR=${shQuote(rutas.target)}`,
  ].join(' ');
  const interno = [
    `cd ${shQuote(rutas.dirRemoto)}`,
    ...(nombreBd ? [comandoBaseRemota(config.bd, nombreBd)] : []),
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
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
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

function correr(cmd, args, { dryRun, cwd, heredar = false }) {
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
  if (r.status !== 0 && !heredar) {
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

// Asegura la sesión de Mutagen, fuerza el envío pendiente y ejecuta cargo en la VPS.
export function ejecutarRemoto({ config, proyecto, rama, cwd, args, dryRun }) {
  const rutas = rutasRemotas(config, proyecto, rama);
  const sesion = nombreSesion(proyecto);
  // [14AA-1] Binario configurable: el instalado en el laptop no está en PATH.
  const mutagen = config.sync?.binario || 'mutagen';

  // [14AA-1] Antes de sincronizar: si no se puede derivar el nombre, no se lanza nada.
  let nombreBd = null;
  if (config.bd?.subcomandos?.includes(args[0])) {
    try {
      nombreBd = nombreBaseDatos(leerCargoToml(cwd), rama, config.proyectos?.[proyecto]?.basedatos);
    } catch (e) {
      console.error(`rcargo: ${e.message}`);
      return 2;
    }
  }

  // En dry-run no se consulta Mutagen: se asume que la sesión no existe.
  const lista = correr(mutagen, ['sync', 'list', sesion], { dryRun, cwd });
  if (lista.status === 2) return 2;
  if (dryRun || !lista.stdout?.includes(sesion)) {
    const crear = argsCrearSesion(config, proyecto, cwd);
    if (correr(mutagen, crear, { dryRun, cwd }).status !== 0) return 1;
    correr('ssh', argsSsh(config, ['mkdir', '-p', rutas.dirRemoto, rutas.target]), { dryRun, cwd });
  }

  if (correr(mutagen, ['sync', 'flush', sesion], { dryRun, cwd }).status !== 0) return 1;

  const remoto = construirComandoRemoto(config, rutas, args, nombreBd);
  return correr('ssh', argsSsh(config, remoto), { dryRun, cwd, heredar: true }).status;
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
  return ejecutarRemoto({ config, proyecto, rama: detectarRama(cwd), cwd, args, dryRun });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
