/* Construcción de una app de escritorio (Tauri 2) usando la 89.
 *
 * [por que] El portátil no compila Rust (AGENTS §1) y el front tiene que estar
 * construido EN LA 89 antes de empotrarlo: en el portátil `dist/` no viaja por
 * Mutagen (está en `sync.ignorar`). Este comando no compone una vía paralela:
 * sincroniza con `asegurarSesion`, construye el front con `comandoConstruirFront`
 * (el mismo que `up`) y compila con el `run-cargo.mjs` del propio proyecto, que
 * a su vez delega en `rcargo.mjs` (candado de carga, target de Windows). */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asegurarSesion, cargarConfig, detectarRama, rutasRemotas } from '../../remoto/rcargo.mjs';
import { comandoConstruirFront } from '../remoto/comandos.mjs';
import { sshRemoto } from '../remoto/red/ssh.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/* Un `.mjs` no importa TypeScript: mismo origen del dato que `WS_AREA_ROOT` de
 * `server/plataforma/rutas.ts` (ver el hermano `scripts/shared/puertos.mjs`). */
const RAIZ_AREA = process.env.WS_AREA_ROOT || path.dirname(RAIZ);
const TIMEOUT_BUILD_MS = 15 * 60_000;

const AYUDA = `uso: dev app <id>
  compila el front en la 89 y luego el .exe de la app de escritorio.
  Sólo para proyectos con src-tauri/ y scripts/run-cargo.mjs propios.`;

/* Carpeta del proyecto por id o por nombre de carpeta. Se mira la ficha antes
 * que la convención: un `src-tauri/` anidado no está en la raíz. */
function carpetaDe(id) {
  if (path.basename(RAIZ) === id && existsSync(path.join(RAIZ, 'src-tauri'))) return RAIZ;
  const fuera = path.join(RAIZ_AREA, id);
  if (!existsSync(fuera)) return null;
  return existsSync(rutaSrcTauri(id, fuera)) ? fuera : null;
}

/* Ruta de `src-tauri/` dentro del proyecto, relativa a su raíz. Por defecto la
 * de siempre (`src-tauri/`, junto al `package.json`); un proyecto con el
 * escritorio en un subdirectorio (p. ej. `clients/desktop/src-tauri`) la
 * declara en su ficha con `appEscritorio.srcTauri`. Sin esto el wrapper
 * respondía «no es una app de escritorio» sobre un proyecto que sí lo es. */
function rutaSrcTauri(id, raizProyecto) {
  try {
    const registro = JSON.parse(readFileSync(path.join(RAIZ, 'config', 'registro.json'), 'utf8'));
    const ficha = (registro.proyectos ?? []).find((p) => p.id === id);
    const rel = ficha?.appEscritorio?.srcTauri;
    if (typeof rel === 'string' && rel.trim()) return path.resolve(raizProyecto, rel);
  } catch {
    /* Sin ficha legible se usa la convención de siempre. */
  }
  return path.join(raizProyecto, 'src-tauri');
}

/* Dónde está el `package.json` del front que se empotra, relativo a la raíz del
 * proyecto. Por defecto la raíz (el `npm run build` de siempre); un proyecto
 * cuyo front vive en un subdirectorio lo declara con `appEscritorio.front`. */
function dirFrontRel(id) {
  try {
    const registro = JSON.parse(readFileSync(path.join(RAIZ, 'config', 'registro.json'), 'utf8'));
    const ficha = (registro.proyectos ?? []).find((p) => p.id === id);
    const rel = ficha?.appEscritorio?.front;
    if (typeof rel === 'string' && rel.trim()) return rel.split('\\').join('/');
  } catch {
    /* Sin ficha legible, la raíz. */
  }
  return '.';
}

/** El mismo front, resuelto contra la raíz local (portátil). */
function dirFront(id, raizProyecto) {
  return path.resolve(raizProyecto, dirFrontRel(id));
}

/** …y contra la raíz remota. Va con `/` literal: `path.resolve` de Windows
 * metería una letra de unidad delante de la ruta de la 89 dentro del `ssh`. */
function dirFrontRemoto(id, dirRemoto) {
  const rel = dirFrontRel(id);
  return rel === '.' ? dirRemoto : `${dirRemoto.replace(/\/+$/, '')}/${rel}`;
}

/* Scripts de `package.json` del proyecto, leídos en el portátil (el árbol es el mismo). */
function scriptsDe(raizProyecto) {
  try {
    return JSON.parse(readFileSync(path.join(raizProyecto, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    return {};
  }
}

/* Lo que `tauri.conf.json` empotra: la ruta (relativa a `src-tauri/`) donde `tauri build` espera
 * el front. Es la fuente, no una convención: hay apps que apuntan al `dist` de OTRO proyecto y
 * otras a un `ui/` estático que no se compila. Sin este dato el wrapper exigía `dist/index.html`
 * y daba por roto un front que estaba bien. */
function frontEmpotrado(raizProyecto, srcTauri) {
  try {
    const conf = JSON.parse(readFileSync(path.join(srcTauri, 'tauri.conf.json'), 'utf8'));
    const rel = conf?.build?.frontendDist;
    return typeof rel === 'string' ? path.resolve(srcTauri, rel) : null;
  } catch {
    return null;
  }
}

/* Front y servidor compilados en la 89 con el mismo ayudante que `up`. Devuelve 0 o el código de salida. */
async function construirFrontPropio(config, rutas, id, raizProyecto, srcTauri) {
  const scripts = scriptsDe(dirFront(id, raizProyecto));
  console.log(`app: construyendo el front de ${id} en la 89`);
  /* `comandoConstruirFront` hace `cd` al árbol de la 89; si el front vive en un
   * subdirectorio se le pasa ese como raíz remota y se conserva el log. */
  const rutasFront = { ...rutas, dirRemoto: dirFrontRemoto(id, rutas.dirRemoto) };
  const front = await sshRemoto(
    config,
    comandoConstruirFront(rutasFront, id, ['npm', 'run', 'build']),
    TIMEOUT_BUILD_MS,
  );
  if (!front.ok) {
    console.error(`app: el front no compiló (log: ${rutas.dirLogs}/construir-front-${id}.log)`);
    if (front.error) console.error(front.error);
    return 1;
  }
  /* El front empotrado tiene que existir en la 89. `frontEmpotrado` da la ruta de verdad; si
   * apunta FUERA del proyecto (el dist de otro), ese artefacto lo construye su dueño y aquí solo
   * se avisa: no es este árbol el que tiene que dejarlo. */
  const esperado = frontEmpotrado(raizProyecto, srcTauri);
  const relEsperado = esperado ? path.relative(raizProyecto, esperado).split('\\').join('/') : null;
  const esDeOtro = relEsperado?.startsWith('..');
  const destino = relEsperado && !esDeOtro ? `${rutas.dirRemoto}/${relEsperado}` : null;
  if (destino) {
    const hay = await sshRemoto(config, `test -f ${destino}/index.html`);
    if (!hay.ok) {
      console.error(`app: el front no dejó ${relEsperado}/index.html en ${config.host}`);
      return 1;
    }
  }
  /* Servidor compilado: la app arranca `node dist-server/server/index.js` desde el repo.
   * [por qué aquí] Lo construía `npm run build` en la cabeza de quien se acordara; un clon
   * nuevo compilaba el .exe y se quedaba sin backend. Va por el mismo ayudante (wrapper).
   * [por qué condicionado] Solo las apps que SIRVEN un backend lo tienen; glory-web es una
   * ventana de WebView2 sobre la web y no gasta `build:server`, así que exigirlo la rompía. */
  if (!scripts['build:server']) return 0;
  console.log(`app: compilando el servidor de ${id} en la 89`);
  const servidor = await sshRemoto(
    config,
    comandoConstruirFront(rutas, id, ['npm', 'run', 'build:server'], 'servidor'),
    TIMEOUT_BUILD_MS,
  );
  const hayServidor = await sshRemoto(config, `test -f ${rutas.dirRemoto}/dist-server/server/index.js`);
  if (!servidor.ok || !hayServidor.ok) {
    console.error(`app: el servidor no compiló (log: ${rutas.dirLogs}/construir-servidor-${id}.log)`);
    if (servidor.error) console.error(servidor.error);
    return 1;
  }
  return 0;
}

/* Nombre del paquete de la app, del `[package].name` de `src-tauri/Cargo.toml`. [por qué] En un
 * workspace, `cargo build` sin `-p` compila el paquete RAÍZ: en glory-web ese es una lib vacía y
 * el wrapper decía «listo» sin ningún .exe (el de la app es `glory-web-app`). El paquete de la
 * ventana es siempre el de `src-tauri/`. */
function paqueteDeLaApp(srcTauri) {
  try {
    const toml = readFileSync(path.join(srcTauri, 'Cargo.toml'), 'utf8');
    /* Solo la sección `[package]` de la cabecera: un `name` de una dependencia no vale. */
    const cabecera = toml.split(/^\[/m)[1] ?? '';
    const nombre = /^name\s*=\s*"([^"]+)"/m.exec(cabecera)?.[1];
    return nombre ?? null;
  } catch {
    return null;
  }
}

export async function app(resto) {
  const [id] = resto;
  if (!id || id.startsWith('--')) {
    console.log(AYUDA);
    return id ? 64 : 0;
  }

  const raizProyecto = carpetaDe(id);
  const srcTauri = raizProyecto ? rutaSrcTauri(id, raizProyecto) : null;
  if (!raizProyecto || !existsSync(srcTauri)) {
    console.error(`app: ${id} no tiene src-tauri/ (no es una app de escritorio)`);
    return 2;
  }
  const wrapper = path.join(raizProyecto, 'scripts', 'run-cargo.mjs');
  if (!existsSync(wrapper)) {
    console.error(`app: falta ${path.relative(RAIZ_AREA, wrapper)}; el build va por el wrapper del taller`);
    return 2;
  }

  const config = cargarConfig();
  const rutas = rutasRemotas(config, id, detectarRama(raizProyecto));

  /* 1) Árbol de la 89 al día. */
  const sync = asegurarSesion({ config, proyecto: id, rutaLocal: raizProyecto, rutas, cwd: raizProyecto });
  if (sync !== 0) {
    console.error('app: no se pudo dejar el árbol de la 89 al día (Mutagen)');
    return sync;
  }

  /* 2) Front en la 89: es lo que se empotra en el exe. Sin `package.json` propio
   * (app que empotra el front de otro proyecto, p. ej. un exe que consume el dist de su web)
   * no hay nada que construir aquí: `tauri.conf` apunta al `dist` ajeno y `tauri build`
   * falla si no existe. El artefacto ajeno lo vigila `Arranque artefactos`. */
  if (existsSync(path.join(dirFront(id, raizProyecto), 'package.json'))) {
    const ok = await construirFrontPropio(config, rutas, id, raizProyecto, srcTauri);
    if (ok !== 0) return ok;
  } else {
    console.log(`app: ${id} no tiene front propio; empotra el dist de su artefacto consumido`);
  }

  /* 3) El exe, por el wrapper del proyecto: nunca `cargo` desde aquí. `-p` con el paquete de
   * `src-tauri/` cuando la raíz es un workspace con otro paquete (glory-web): sin eso se compila
   * la lib raíz, sale código 0 y no hay .exe. */
  console.log(`app: compilando ${id} para Windows`);
  const paquete = paqueteDeLaApp(srcTauri);
  /* Si el escritorio está en un subdirectorio, la raíz del proyecto no es el
   * paquete: hay que decirle a cargo dónde está su manifiesto. Relativo y con
   * `/`: cargo corre en el árbol de la 89 (`cwd` local se traduce al sincronizar)
   * y una ruta `C:\…` no existe allí. */
  const estandar = path.join(raizProyecto, 'src-tauri') === srcTauri;
  const manifiesto = estandar
    ? []
    : ['--manifest-path', path.relative(raizProyecto, srcTauri).split('\\').join('/') + '/Cargo.toml'];
  const args = [wrapper, 'xwin', 'build', '--release', ...(paquete ? ['-p', paquete] : []), ...manifiesto];
  const build = spawnSync(process.execPath, args, {
    cwd: raizProyecto,
    stdio: 'inherit',
  });
  if (build.status === 0) {
    console.log(`app: listo → ${rutas.target}/x86_64-pc-windows-msvc/release/`);
  }
  return build.status ?? 1;
}
