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

// Registro de supervision (plan-supervision-proyectos-2026-10-20): dice como se arranco cada
// sesion, para que el vigilante pueda repetirlo sin saber arrancar proyectos por su cuenta.
// [por que] En ~/.local/share/taller/ y no en /var/tmp ni en ~/.cache: cm-sweep barre esos dos
// sin umbral y se llevaria el registro por delante (AGENTS §1).

export const DIR_SUPERVISAR = '$HOME/.local/share/taller/supervisar';

// Un registro por sesion, con el nombre de la sesion: asi `stop` borra exactamente el suyo.
export const rutaRegistro = (sesion) => `${DIR_SUPERVISAR}/${sesion}.sh`;

// El borrado viaja en el MISMO comando que mata la sesion, y antes: si se matara primero, el
// vigilante podria recrearla entre las dos ordenes y el `stop` no pararia nada.
export const borrarRegistro = (id, puerto) => `rm -f ${DIR_SUPERVISAR}/${sesionTmux(id, puerto)}.sh`;

// Bucle de reinicio dentro de la propia sesion: recupera en segundos, sin esperar al cron.
// [por que] La espera crece con los fallos seguidos (10 s ... 60 s) para no girar en caliente
// sobre un build roto; si el proceso llego a durar un minuto, el fallo es nuevo y vuelve a la
// espera corta. Cada vuelta deja su linea en el log: se ve, no se esconde.

const bucleSupervisado = (base, log) => [
  'n=0; while :; do',
  `inicio=$(date +%s); ${base} >> ${shQuote(log)} 2>&1; dur=$(( $(date +%s) - inicio ));`,
  '[ "$dur" -ge 60 ] && n=0; n=$((n+1)); [ "$n" -gt 6 ] && n=6; espera=$((n*10));',
  `echo "[supervisar] el proceso termino tras \${dur}s; reintento en \${espera}s" >> ${shQuote(log)};`,
  'sleep "$espera"; done',
].join(' ');

// El registro lo lee taller-vigilante.sh (bash, sin jq). Los valores van en base64 para poder
// leerlos con un `sed` de lista blanca: ni comillas ni escapes que interpretar.
// [por que] Se guarda el argumento de tmux YA escapado, no el comando en crudo: el vigilante lo
// repite tal cual y no hay una segunda rutina de escapado que pueda divergir de esta.

function comandoRegistrar(sesion, rutas, id, puerto, argumento) {
  const b64 = (texto) => Buffer.from(texto, 'utf8').toString('base64');
  const contenido = [
    '# Registro de supervision del taller. Lo escribe Arranque up; lo lee taller-vigilante.sh.',
    '# Valores en base64, uno por linea: se leen con un sed de lista blanca, sin evaluar nada.',
    `PROYECTO='${b64(id)}'`,
    `PUERTO='${b64(String(puerto))}'`,
    `SESION='${b64(sesion)}'`,
    `DIR='${b64(rutas.dirRemoto)}'`,
    `ARGUMENTO='${b64(argumento)}'`,
    '',
  ].join('\n');
  const ruta = rutaRegistro(sesion);
  return `mkdir -p ${DIR_SUPERVISAR} && printf '%s' ${shQuote(contenido)} > ${ruta} && chmod 600 ${ruta}`;
}

// `supervisar` (bandera de la ficha) deja el arranque grabado y mete el proceso en un bucle de
// reinicio. Sin la bandera nada cambia: es opt-in porque cada proyecto supervisado ocupa memoria
// de forma permanente.

export function comandoRemotoUp(config, rutas, id, puerto, boton, env = {}, supervisar = false) {
  const log = `${rutas.dirLogs}/dev-up-${id}-${puerto}.log`;
  const base = `${PATH_NODE}${SQLX_OFFLINE}${SIN_RUSTC_WRAPPER}${prefijoEnv(env)}CARGO_TARGET_DIR=${shQuote(rutas.target)} ${boton.map(shQuote).join(' ')}`;
  const interno = supervisar ? bucleSupervisado(base, log) : `${base} >> ${shQuote(log)} 2>&1`;
  const sesion = sesionTmux(id, puerto);
  const argumento = `bash -lc ${shQuote(interno)}`;
  const partes = [
    `mkdir -p ${shQuote(rutas.dirLogs)}`,
    `(tmux has-session -t ${shQuote(sesion)} 2>/dev/null || tmux new-session -d -s ${shQuote(sesion)} -c ${shQuote(rutas.dirRemoto)} ${shQuote(argumento)})`,
  ];
  // Despues de crear la sesion: si el arranque falla, no queda un registro que el vigilante
  // resucite por su cuenta.
  if (supervisar) partes.push(comandoRegistrar(sesion, rutas, id, puerto, argumento));
  return partes.join(' && ');
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

/* [por que `etiqueta`] El mismo ayudante construye el front y el servidor compilado: si los
 * dos escribieran en `construir-front-<id>.log`, el fallo del segundo se leería en el log del
 * primero. */
export function comandoConstruirFront(rutas, id, argv, etiqueta = 'front') {
  const log = `${rutas.dirLogs}/construir-${etiqueta}-${id}.log`;
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

// Por cada puerto dice quien lo escucha: `nuestro` si desciende del panel tmux del proyecto o corre
// desde su carpeta; `ajeno` si no; `libre` si nadie. Una sola llamada ssh para todos los puertos.
// [por que] `ss` solo nombra al oyente: sin subir por el arbol de procesos no se sabe si lo lanzo
// este proyecto. Sin esto, un puerto ocupado por otro proceso daba `ya-arriba` (12AA-7).
// Salida: `<puerto> <nuestro|ajeno|libre> <pid|-> <comando>`, una linea por puerto.
export function comandoDuenosRemotos(id, puertos, dirRemoto) {
  const script = [
    'dueno() {',
    '  p=$1; s=$2; dir=$3',
    '  linea=$(ss -ltnpH | grep -m1 ":$p ")',
    '  [ -z "$linea" ] && { echo "$p libre - -"; return; }',
    '  pid=$(echo "$linea" | grep -o "pid=[0-9]*" | cut -d= -f2)',
    // [por que] Sin pid visible (oyente de otro usuario) no se puede demostrar que sea nuestro: va como ajeno.
    '  [ -z "$pid" ] && { echo "$p ajeno - (pid no visible)"; return; }',
    '  cmd=$(tr "\\0" " " < /proc/$pid/cmdline 2>/dev/null | cut -c1-160)',
    '  pane=$(tmux display-message -p -t "$s" "#{pane_pid}" 2>/dev/null)',
    '  est=ajeno; x=$pid',
    '  while [ -n "$x" ] && [ "$x" -gt 1 ]; do',
    '    [ "$x" = "$pane" ] && { est=nuestro; break; }',
    '    x=$(sed "s/.*) //" /proc/$x/stat 2>/dev/null | cut -d" " -f2)',
    '  done',
    '  case "$(readlink /proc/$pid/cwd 2>/dev/null)/ $cmd" in *"$dir"/*) est=nuestro;; esac',
    '  echo "$p $est $pid ${cmd:-(sin cmdline)}"',
    '}',
    ...puertos.map((p) => `dueno ${p} ${shQuote(sesionTmux(id, p))} ${shQuote(dirRemoto)}`),
  ].join('\n');
  return `bash -c ${shQuote(script)}`;
}

// Puertos remotos de TODOS los modos de la ficha (dev ∪ build). [por que] Las sesiones tmux se
// nombran por puerto, asi que al cambiar de modo la sesion del otro modo quedaba viva y sin dueno:
// un `up` en build con el vite de dev arriba dejaba 150-650 MB huerfanos, justo lo que build ahorra.
