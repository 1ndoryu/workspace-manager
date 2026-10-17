/* Construccion de los comandos que corren en la VPS (arranque, build, npm ci, sondas). */

import { SIN_RUSTC_WRAPPER, shQuote, slugSesion } from '../../remoto/rcargo.mjs';

export const sesionTmux = (id, puerto) => `dev-${slugSesion(id)}-${puerto}`;

const argvConCandado = (config, argv) => (argv[0] === 'cargo' ? [config.lockWrapper, ...argv] : argv);

const prefijoEnv = (env) => Object.entries(env).map(([k, v]) => `${k}=${shQuote(v)} `).join('');
// [por que] node no está en el PATH de `bash -lc`: fnm no se activa en shells no interactivos (.bashrc corta antes) y .profile no tiene `fnm env`. El alias default de fnm es una ruta estable.

const PATH_NODE = 'export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"; ';

// [por que] sqlx compila contra la caché .sqlx/ (como el Dockerfile del proyecto), no contra la base: la de la 89 puede estar vacía o sin migrar.

const SQLX_OFFLINE = 'SQLX_OFFLINE=true ';

// Una sesion tmux por puerto. Idempotente: si la sesion ya existe, no hace nada.
// env (registro + DATABASE_URL): el proceso lo recibe en la línea de comando, que gana al .env. Nombres validados en validarHostRemoto.

export function comandoRemotoUp(config, rutas, id, puerto, boton, env = {}) {
  const log = `${rutas.dirLogs}/dev-up-${id}-${puerto}.log`;
  const interno = `${PATH_NODE}${SQLX_OFFLINE}${SIN_RUSTC_WRAPPER}${prefijoEnv(env)}CARGO_TARGET_DIR=${shQuote(rutas.target)} ${boton.map(shQuote).join(' ')} >> ${shQuote(log)} 2>&1`;
  const sesion = sesionTmux(id, puerto);
  return [
    `mkdir -p ${shQuote(rutas.dirLogs)}`,
    `(tmux has-session -t ${shQuote(sesion)} 2>/dev/null || tmux new-session -d -s ${shQuote(sesion)} -c ${shQuote(rutas.dirRemoto)} ${shQuote(`bash -lc ${shQuote(interno)}`)})`,
  ].join(' && ');
}

// Precompilación: el build en frío (minutos) corre antes del tmux y deja el target listo para `cargo run`.
// [por que] La salida va a un log: una compilación en frío no cabe en la salida de ssh. Mismo CARGO_TARGET_DIR que el arranque.

export function comandoPrecompilar(config, rutas, id, argv, env = {}) {
  const log = `${rutas.dirLogs}/precompilar-${id}.log`;
  const interno = `${SQLX_OFFLINE}${SIN_RUSTC_WRAPPER}${prefijoEnv(env)}CARGO_TARGET_DIR=${shQuote(rutas.target)} ${argvConCandado(config, argv).map(shQuote).join(' ')}`;
  return `mkdir -p ${shQuote(rutas.dirLogs)} && cd ${shQuote(rutas.dirRemoto)} && bash -lc ${shQuote(interno)} >> ${shQuote(log)} 2>&1`;
}

// Build del front en modo build: **sin cm-heavy**. Son ~200 MB y 11,5 s; meterlo en el mismo saco
// tendría un efecto perverso: sin 6 GB libres no se podría ni reconstruir el front aunque el binario
// Rust ya estuviera compilado. Y **sin el env del registro**: `vite build` hornea lo que ve, y
// `entrada.env` lleva la URL del proxy de dev (`http://localhost:3103`), que desde el navegador del
// portátil no existe. Solo cuenta el `env K=V` escrito en su propio argv.

export function comandoConstruirFront(rutas, id, argv) {
  const log = `${rutas.dirLogs}/construir-front-${id}.log`;
  const interno = `${PATH_NODE}cd ${shQuote(rutas.dirRemoto)} && ${argv.map(shQuote).join(' ')}`;
  return `mkdir -p ${shQuote(rutas.dirLogs)} && bash -lc ${shQuote(interno)} >> ${shQuote(log)} 2>&1`;
}

// npm ci solo si cambió package-lock.json: la marca es su sha256 dentro de node_modules (node_modules no viaja por Mutagen).

const etiquetaNpm = (sub) => (sub === '.' ? 'raiz' : sub.replace(/[^A-Za-z0-9]+/g, '_'));

export const rutaLogNpmCi = (dirLogs, sub, id) => `${dirLogs}/npm-ci-${id}-${etiquetaNpm(sub)}.log`;

export function comandoNpmCi(dirRemoto, dirLogs, sub, id) {
  const dir = sub === '.' ? dirRemoto : `${dirRemoto}/${sub}`;
  const interno = `${PATH_NODE}set -eo pipefail; cd ${shQuote(dir)}; h=$(sha256sum package-lock.json | cut -d' ' -f1); if [ "$(cat node_modules/.taller-lock-sha256 2>/dev/null)" = "$h" ]; then echo 'npm ci: al dia'; else npm ci && mkdir -p node_modules && echo "$h" > node_modules/.taller-lock-sha256; fi`;
  return `mkdir -p ${shQuote(dirLogs)} && bash -lc ${shQuote(interno)} >> ${shQuote(rutaLogNpmCi(dirLogs, sub, id))} 2>&1`;
}

// Salida de `ss -ltnH`: columna 4 = direccion local. Cualquier direccion no loopback es escucha publica.

export const comandoSondaRemota = (puerto, ruta, marcador = null) => {
  const url = shQuote(`http://127.0.0.1:${puerto}${ruta}`);
  if (!marcador) return `curl -s -o /dev/null -w '%{http_code}' --max-time 2 ${url}`;
  // El cuerpo va a un temporal para poder buscar el marcador; el código HTTP no basta para
  // distinguir la SPA de un 200 de la API.
  return `t=$(mktemp); s=$(curl -s -o "$t" -w '%{http_code}' --max-time 2 ${url}); if [ "$s" = 200 ] && grep -qF -- ${shQuote(marcador)} "$t"; then echo 200; else echo 000; fi; rm -f "$t"`;
};


export function comandoSesiones(sesiones) {
  return sesiones.map((s) => `if tmux has-session -t ${shQuote(s)} 2>/dev/null; then echo ${shQuote(s)}; fi`).join('; ');
}

// Puertos remotos de TODOS los modos de la ficha (dev ∪ build). [por que] Las sesiones tmux se
// nombran por puerto, asi que al cambiar de modo la sesion del otro modo quedaba viva y sin dueno:
// un `up` en build con el vite de dev arriba dejaba 150-650 MB huerfanos, justo lo que build ahorra.
