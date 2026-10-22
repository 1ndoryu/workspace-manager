/* Construcción de una app de escritorio (Tauri 2) usando la 89.
 *
 * [por que] El portátil no compila Rust (AGENTS §1) y el front tiene que estar
 * construido EN LA 89 antes de empotrarlo: en el portátil `dist/` no viaja por
 * Mutagen (está en `sync.ignorar`). Este comando no compone una vía paralela:
 * sincroniza con `asegurarSesion`, construye el front con `comandoConstruirFront`
 * (el mismo que `up`) y compila con el `run-cargo.mjs` del propio proyecto, que
 * a su vez delega en `rcargo.mjs` (candado de carga, target de Windows). */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

/** Carpeta del proyecto por id o por nombre de carpeta. */
function carpetaDe(id) {
  const propia = path.join(RAIZ, 'src-tauri');
  if (path.basename(RAIZ) === id && existsSync(propia)) return RAIZ;
  const fuera = path.join(RAIZ_AREA, id);
  return existsSync(path.join(fuera, 'src-tauri')) ? fuera : null;
}

export async function app(resto) {
  const [id] = resto;
  if (!id || id.startsWith('--')) {
    console.log(AYUDA);
    return id ? 64 : 0;
  }

  const raizProyecto = carpetaDe(id);
  if (!raizProyecto) {
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

  /* 2) Front en la 89: es lo que se empotra en el exe. */
  console.log(`app: construyendo el front de ${id} en la 89`);
  const front = await sshRemoto(
    config,
    comandoConstruirFront(rutas, id, ['npm', 'run', 'build']),
    TIMEOUT_BUILD_MS,
  );
  if (!front.ok) {
    console.error(`app: el front no compiló (log: ${rutas.dirLogs}/construir-front-${id}.log)`);
    if (front.error) console.error(front.error);
    return 1;
  }
  const hayDist = await sshRemoto(config, `test -f ${rutas.dirRemoto}/dist/index.html`);
  if (!hayDist.ok) {
    console.error(`app: el front no dejó dist/index.html en ${config.host}`);
    return 1;
  }
  /* 2b) Servidor compilado: la app arranca `node dist-server/server/index.js` desde el repo.
   * [por qué aquí] Lo construía `npm run build` en la cabeza de quien se acordara; un clon
   * nuevo compilaba el .exe y se quedaba sin backend. Va por el mismo ayudante (wrapper). */
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

  /* 3) El exe, por el wrapper del proyecto: nunca `cargo` desde aquí. */
  console.log(`app: compilando ${id} para Windows`);
  const build = spawnSync(process.execPath, [wrapper, 'xwin', 'build', '--release'], {
    cwd: raizProyecto,
    stdio: 'inherit',
  });
  if (build.status === 0) {
    console.log(`app: listo → ${rutas.target}/x86_64-pc-windows-msvc/release/`);
  }
  return build.status ?? 1;
}
