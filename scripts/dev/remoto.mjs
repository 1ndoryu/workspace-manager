/* F3 taller remoto (VPS 89): una entrada del registro con `host` corre en la VPS,
 * en una sesion tmux por puerto. El laptop mantiene un tunel SSH hacia 127.0.0.1,
 * salvo tunelSsh:false (la VPS expone sus puertos sola, p. ej. Cloudflare Tunnel).
 * Diseno: Agente/planes/plan-taller-remoto-vps89-2026-10-14.md.
 * [por que] El mando local no ve procesos remotos: la verdad es la sesion tmux
 * (en 89) y el PID del tunel (local, validado por creationTime e imagen/cmdline).
 * Sin probe por el tunel no hay verde; un puerto escuchando fuera de loopback
 * en 89 se mata antes de exponer nada. */
import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import {
  argsSsh,
  asegurarSesion,
  cargarConfig,
  comandoBaseRemota,
  detectarRama,
  nombreBaseDatos,
  rutasRemotas,
  shQuote,
  urlBaseRemota,
} from '../remoto/rcargo.mjs';
import { leerRegistro, procesosDe, PUERTOS_PROTEGIDOS, RAIZ_REPO } from './doctor.mjs';

const DIR_LOGS = join(RAIZ_REPO, 'logs');
const rutaEstado = (id) => join(DIR_LOGS, `remoto-${id}.json`);
const sesionTmux = (id, puerto) => `dev-${id}-${puerto}`;
const fragmentoReenvio = (local, remoto) => `127.0.0.1:${local}:127.0.0.1:${remoto}`;
// [por que] puertosRemotos (opcional): puertos que escucha la VPS cuando difieren de `puertos` (el dev local). Todo el flujo remoto usa esta lista.
const puertosRemotosDe = (entrada) => entrada.puertosRemotos ?? entrada.puertos;
// [por que] puertosLocales (opcional, misma longitud que los remotos): el túnel abre ese puerto en el laptop y deja el remoto igual.
// Permite tener el dev local encendido sin chocar con el remoto; el resto del flujo (probe, marcador) usa el local.
const puertosLocalesDe = (entrada) => puertosRemotosDe(entrada).map((p, i) => entrada.puertosLocales?.[i] ?? p);
// [por que] tunelSsh (opcional, true por defecto): false = la VPS expone sus puertos sola (Cloudflare Tunnel en la 89); el laptop no reenvía nada y el probe corre en la 89.
const usaTunel = (entrada) => entrada.tunelSsh !== false;

export function esEntradaRemota(entrada) {
  return typeof entrada?.host === 'string' && entrada.host !== '';
}

// [por que] Los nombres de variable van sin entrecomillar en el shell remoto y en el .env: solo identificadores.
const RE_NOMBRE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;
const dependenciaSegura = (d) => typeof d === 'string' && d !== '' && !isAbsolute(d) && !d.split(/[\\/]/).includes('..');

// Solo el host declarado en taller.json; sin requiere (no hay orquestacion remota de dependencias).
export function validarHostRemoto(entrada, config) {
  if (entrada.host !== config.host) return `host '${entrada.host}' no permitido (solo '${config.host}')`;
  if (entrada.requiere?.length) return 'requiere no se soporta en host remoto';
  const remotos = puertosRemotosDe(entrada);
  if (!Array.isArray(remotos) || remotos.length === 0 || remotos.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535)) {
    return 'puertos remotos: lista de puertos (1024-65535), no vacía';
  }
  const protegidos = remotos.filter((p) => PUERTOS_PROTEGIDOS.has(p));
  if (protegidos.length) return `puertos protegidos ${protegidos.join(',')} no se reenvian al laptop`;
  if (entrada.tunelSsh !== undefined && typeof entrada.tunelSsh !== 'boolean') return 'tunelSsh debe ser true o false';
  if (entrada.tunelSsh === false && entrada.puertosLocales !== undefined) return 'puertosLocales no aplica con tunelSsh false';
  if (entrada.puertosLocales !== undefined) {
    const pl = entrada.puertosLocales;
    if (!Array.isArray(pl) || pl.length !== remotos.length || pl.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535)) {
      return 'puertosLocales debe tener un puerto local (1024-65535) por cada puerto remoto';
    }
    if (new Set(pl).size !== pl.length) return 'puertosLocales repetidos';
    const locProtegidos = pl.filter((p) => PUERTOS_PROTEGIDOS.has(p));
    if (locProtegidos.length) return `puertos locales protegidos ${locProtegidos.join(',')}`;
  }
  const envInvalidas = Object.keys(entrada.env ?? {}).filter((k) => !RE_NOMBRE_ENV.test(k));
  if (envInvalidas.length) return `nombres de variable no válidos en env: ${envInvalidas.join(',')}`;
  if (entrada.envRemoto !== undefined && entrada.envRemoto !== 'todo') {
    if (!Array.isArray(entrada.envRemoto)) return 'envRemoto debe ser "todo" o una lista de nombres';
    const malas = entrada.envRemoto.filter((k) => typeof k !== 'string' || !RE_NOMBRE_ENV.test(k));
    if (malas.length) return `nombres no válidos en envRemoto: ${malas.join(',')}`;
  }
  const deps = entrada.dependencias ?? [];
  if (!Array.isArray(deps)) return 'dependencias debe ser una lista de rutas';
  const fuera = deps.filter((d) => !dependenciaSegura(d));
  if (fuera.length) return `dependencias fuera del proyecto: ${fuera.join(',')}`;
  const pasos = entrada.precompilar ?? [];
  if (!Array.isArray(pasos)) return 'precompilar debe ser una lista de comandos';
  if (pasos.some((p) => !Array.isArray(p) || p.length === 0 || p.some((s) => typeof s !== 'string'))) {
    return 'precompilar debe ser una lista de comandos (cada uno, una lista de textos)';
  }
  // [por que] botonRemoto: el mando local usa `boton` (p. ej. `npm run dev:back`, que llama al wrapper local y no sirve en la 89).
  if (entrada.botonRemoto !== undefined && (!Array.isArray(entrada.botonRemoto) || entrada.botonRemoto.length !== remotos.length)) {
    return 'botonRemoto debe tener un comando por puerto';
  }
  const botones = entrada.botonRemoto ?? entrada.boton ?? [];
  const conCargo = botones.some((b) => Array.isArray(b) && b[0] === 'cargo');
  if (conCargo && pasos.length === 0) return 'boton cargo sin precompilar: el build correría fuera de cm-heavy';
  return null;
}

// Protocolo del .env (envRemoto): "todo" copia el archivo; una lista copia solo esas claves.
// [por que] Fail-closed: una clave pedida que no está en el .env local vuelve en `faltan` y no se arranca sin ella.
// La DATABASE_URL se sustituye por la de la VPS cuando hay urlBd (base de la rama en la 89, nunca la del laptop).
export function contenidoEnvRemoto(textoEnv, envRemoto, urlBd = null) {
  const claveDe = (linea) => linea.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1] ?? null;
  const reemplazar = (linea) => (urlBd && claveDe(linea) === 'DATABASE_URL' ? `DATABASE_URL=${urlBd}` : linea);
  const lineas = textoEnv.split(/\r?\n/);
  if (envRemoto === 'todo') return { contenido: lineas.map(reemplazar).join('\n'), faltan: [] };
  const presentes = new Set(lineas.map(claveDe).filter(Boolean));
  const faltan = envRemoto.filter((k) => !presentes.has(k));
  const pedidas = new Set(envRemoto);
  const elegidas = lineas.filter((l) => pedidas.has(claveDe(l))).map(reemplazar);
  return { contenido: `${elegidas.join('\n')}\n`, faltan };
}

// [por que] Vite solo lee su propio entorno (su `envDir` es la raíz del front, no la del proyecto), así que las
// claves VITE_* del `.env` que se copia a la 89 nunca llegan a `import.meta.env`: van además a frontend/.env.local,
// que es donde Vite las busca. Sin esto, la auto-entrada del dev público se queda sin credenciales [15AA-1].
export function contenidoEnvFrontend(contenidoEnv) {
  const claves = contenidoEnv.split(/\r?\n/).filter((l) => /^\s*(?:export\s+)?VITE_[A-Za-z0-9_]*\s*=/.test(l));
  return claves.length ? `${claves.join('\n')}\n` : null;
}

// Sincronización BD local -> 89 (decidido 2026-10-14). Solo loopback: nunca se copia desde una base que no sea la del laptop.
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1']);
const decodificarUrl = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// [por que] Los errores no incluyen la URL ni la clave: van a logs y al resumen.
export function leerUrlBdLocal(textoEnv) {
  const linea = textoEnv.split(/\r?\n/).find((l) => /^\s*(?:export\s+)?DATABASE_URL\s*=/.test(l));
  if (linea === undefined) throw new Error('DATABASE_URL no está en el .env local');
  const url = linea.replace(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*/, '').trim();
  // [por que] La clave puede llevar '@' sin codificar: el último '@' separa credenciales de host.
  const m = url.match(/^postgres(?:ql)?:\/\/([^:/@]+):(.+)@(\[[^\]]+\]|[^:/@]+):(\d+)\/([^/?#\s]+)$/);
  if (!m) throw new Error('DATABASE_URL del .env local no tiene el formato postgres://usuario:clave@host:puerto/nombre');
  const host = m[3].replace(/^\[|\]$/g, '');
  if (!HOSTS_LOCALES.has(host)) {
    throw new Error(`DATABASE_URL del .env local apunta a '${host}', no a loopback: no se sincroniza desde una base que no sea la local`);
  }
  return { usuario: decodificarUrl(m[1]), clave: decodificarUrl(m[2]), host, puerto: Number(m[4]), nombre: decodificarUrl(m[5]) };
}

// [por que] pg_dump 18 (laptop) emite estas líneas, que psql 16 (89) no acepta; pg_dump -Fc tampoco se lee con 16.
const LINEA_SOLO_PG18 = /^(?:SET transaction_timeout\b|\\restrict\b|\\unrestrict\b)/;
export function filtrarSqlParaPg16(texto) {
  // (?<=\n) conserva los finales de línea (CRLF incluido): el resto del fichero queda igual.
  return texto.split(/(?<=\n)/).filter((linea) => !LINEA_SOLO_PG18.test(linea)).join('');
}

// Reenvio solo a loopback en ambos extremos; ExitOnForwardFailure hace que ssh salga si un puerto no se puede reenviar.
// ControlMaster=no: el PID de este proceso es el tunel (con multiplexado ssh delegaria y saldria).
export function argsTunel(config, entrada) {
  const locales = puertosLocalesDe(entrada);
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    ...puertosRemotosDe(entrada).flatMap((p, i) => ['-L', fragmentoReenvio(locales[i], p)]),
    config.host,
  ];
}

// Para `expectedCmdline` del registro (fragmentos por puerto): doctor atribuye el tunel ssh como propio.
export function marcadorTunel(config, entrada) {
  const locales = puertosLocalesDe(entrada);
  return [config.host, ...puertosRemotosDe(entrada).map((p, i) => fragmentoReenvio(locales[i], p))];
}

export function tunelEsNuestro(proc, config, entrada) {
  if (!proc?.creado || !proc.cmd) return false;
  if (!/^ssh(\.exe)?$/i.test(proc.imagen ?? '')) return false;
  if (!marcadorTunel(config, entrada).every((f) => proc.cmd.includes(f))) return false;
  // [por que] Un túnel de una versión anterior con reenvíos de más (p. ej. 3202→3102) contiene todos los marcadores:
  // se rechaza por exceso; si no, queda huérfano y ocupa el puerto local que `up` necesita.
  return (proc.cmd.match(/(^|\s)-L\s/g) ?? []).length === puertosRemotosDe(entrada).length;
}

// cm-heavy (lock de carga pesada de la VPS, §5 del taller) solo al compilar: decidido 2026-10-14.
// [por que] El candado dura lo que dura el build, no la vida del servidor; por eso `cargo` en `boton` exige `precompilar` (validarHostRemoto).
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
  const interno = `${PATH_NODE}${SQLX_OFFLINE}${prefijoEnv(env)}CARGO_TARGET_DIR=${shQuote(rutas.target)} ${boton.map(shQuote).join(' ')} >> ${shQuote(log)} 2>&1`;
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
  const interno = `${SQLX_OFFLINE}${prefijoEnv(env)}CARGO_TARGET_DIR=${shQuote(rutas.target)} ${argvConCandado(config, argv).map(shQuote).join(' ')}`;
  return `mkdir -p ${shQuote(rutas.dirLogs)} && cd ${shQuote(rutas.dirRemoto)} && bash -lc ${shQuote(interno)} >> ${shQuote(log)} 2>&1`;
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
export function analizarEscucha(salidaSs, puerto) {
  const sufijo = `:${puerto}`;
  const locales = salidaSs
    .split(/\r?\n/)
    .map((linea) => linea.trim().split(/\s+/)[3] ?? '')
    .filter((local) => local.endsWith(sufijo));
  const publicas = locales.filter((local) => {
    const host = local.slice(0, -sufijo.length);
    return !(host.startsWith('127.') || host === '[::1]');
  });
  return { escucha: locales.length > 0, publicas };
}

// PIDs de los sockets en escucha loopback de esos puertos (`netstat -ano -p TCP`). Un escucha público (0.0.0.0) no cuenta.
export function pidsEscuchandoLocal(salidaNetstat, puertos) {
  const pids = new Set();
  const enPuertos = new Set(puertos.map(Number));
  for (const linea of salidaNetstat.split(/\r?\n/)) {
    const t = linea.trim().split(/\s+/);
    if (t[0] !== 'TCP' || t.length < 5 || !/^\d+$/.test(t[4])) continue;
    if (!/^(0\.0\.0\.0|\[::\]):0$/.test(t[2])) continue;
    const m = t[1].match(/^(127\.0\.0\.1|\[::1\]):(\d+)$/);
    if (m && enPuertos.has(Number(m[2]))) pids.add(Number(t[4]));
  }
  return [...pids];
}

// PID del proceso que escucha en el puerto (`ss -ltnpH`); null si ss no lo muestra (sin permiso o sin escucha).
export function pidDeEscucha(salidaSs, puerto) {
  const sufijo = `:${puerto}`;
  for (const linea of salidaSs.split(/\r?\n/)) {
    if (!(linea.trim().split(/\s+/)[3] ?? '').endsWith(sufijo)) continue;
    const m = linea.match(/pid=(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

// [por que] Lo que cuenta es el entorno del proceso vivo (/proc/<pid>/environ), no el registro ni el de la última `up`:
// un proceso arrancado con otro entorno da el puerto por bueno aunque el estado diga otra cosa.
export function variablesDistintas(textoEnviron, esperado) {
  const actual = new Map();
  for (const linea of textoEnviron.split(/\r?\n/)) {
    const i = linea.indexOf('=');
    if (i > 0) actual.set(linea.slice(0, i), linea.slice(i + 1));
  }
  return Object.entries(esperado)
    .filter(([k, v]) => actual.get(k) !== String(v))
    .map(([k]) => k);
}

function sondear(puerto, ruta = '/', timeoutMs = 2000) {
  return new Promise((resolveP) => {
    const req = http.get({ host: '127.0.0.1', port: puerto, path: ruta, timeout: timeoutMs }, (res) => {
      res.resume();
      resolveP(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolveP(false));
  });
}

async function esperarSonda(puerto, ruta, limiteMs) {
  const t0 = Date.now();
  while (!(await sondear(puerto, ruta))) {
    if (Date.now() - t0 > limiteMs) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return true;
}

// Sin túnel, el probe corre en la 89 contra su loopback, con el mismo criterio que sondear (solo 200).
// [por que] La salida es el código HTTP; el código de salida de curl no se usa (000 = sin respuesta).
export const comandoSondaRemota = (puerto, ruta) => `curl -s -o /dev/null -w '%{http_code}' --max-time 2 ${shQuote(`http://127.0.0.1:${puerto}${ruta}`)}`;

async function esperarSondaRemota(config, puerto, ruta, limiteMs) {
  const t0 = Date.now();
  for (;;) {
    const r = await sshRemoto(config, comandoSondaRemota(puerto, ruta), 10_000);
    if (r.salida.trim() === '200') return true;
    if (Date.now() - t0 > limiteMs) return false;
    await new Promise((res) => setTimeout(res, 1000));
  }
}

// codigo: el de salida remoto (p. ej. 75 = cm-heavy ocupado); 1 si ssh no llegó a ejecutar o expiró el timeout.
function sshRemoto(config, comando, timeoutMs = 30_000) {
  return new Promise((resolveP) => {
    execFile('ssh', argsSsh(config, [comando]), { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolveP({
        ok: !err,
        codigo: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        salida: String(stdout ?? ''),
        error: String(stderr || err?.message || '').trim().slice(0, 300),
      });
    });
  });
}

// [por que] El contenido viaja por stdin: no aparece en la línea de comando ni en `ps`. Temporal + mv: nunca un archivo a medias.
function escribirArchivoRemoto(config, ruta, contenido, timeoutMs = 30_000) {
  const tmp = `${ruta}.tmp-${process.pid}`;
  // [por que] mkdir -p del padre en la misma llamada: el directorio puede no existir aún (primer `up` de un proyecto).
  const comando = `mkdir -p ${shQuote(ruta.slice(0, ruta.lastIndexOf('/')))} && umask 077 && cat > ${shQuote(tmp)} && chmod 600 ${shQuote(tmp)} && mv -f ${shQuote(tmp)} ${shQuote(ruta)}`;
  return new Promise((resolveP) => {
    const hijo = spawn('ssh', argsSsh(config, [comando]), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    hijo.stderr.on('data', (d) => { stderr += d; });
    const reloj = setTimeout(() => hijo.kill(), timeoutMs);
    hijo.on('error', (e) => { clearTimeout(reloj); resolveP({ ok: false, codigo: 1, error: e.message }); });
    hijo.on('close', (code) => {
      clearTimeout(reloj);
      resolveP({ ok: code === 0, codigo: code ?? 1, error: stderr.trim().slice(0, 300) });
    });
    hijo.stdin.end(contenido);
  });
}

function comandoSesiones(sesiones) {
  return sesiones.map((s) => `if tmux has-session -t ${shQuote(s)} 2>/dev/null; then echo ${shQuote(s)}; fi`).join('; ');
}

// Pide Ctrl-C y luego mata la sesion. Si ssh falla, lo devuelve: el tunel se cierra igual.
function pararSesiones(config, id, entrada) {
  return pararSesionesPuertos(config, id, puertosRemotosDe(entrada));
}

function pararSesionesPuertos(config, id, puertos) {
  const comando = puertos
    .map((p) => {
      const s = shQuote(sesionTmux(id, p));
      return `tmux send-keys -t ${s} C-c 2>/dev/null; sleep 2; tmux kill-session -t ${s} 2>/dev/null; true`;
    })
    .join('; ');
  return sshRemoto(config, comando);
}

function leerEstado(id) {
  try {
    return JSON.parse(readFileSync(rutaEstado(id), 'utf8'));
  } catch {
    return null;
  }
}

function escribirEstado(id, estado) {
  mkdirSync(DIR_LOGS, { recursive: true });
  writeFileSync(rutaEstado(id), `${JSON.stringify(estado, null, 2)}\n`);
}

// PID del tunel solo si sigue siendo el que abrimos (creationTime exacta) y su linea de comando es la nuestra.
async function tunelVivo(config, entrada, estado) {
  if (!estado?.tunelPid) return null;
  const proc = (await procesosDe([estado.tunelPid])).get(estado.tunelPid);
  if (!proc || proc.creado !== estado.tunelCreado || !tunelEsNuestro(proc, config, entrada)) return null;
  return estado.tunelPid;
}

async function abrirTunel(config, entrada, id) {
  mkdirSync(DIR_LOGS, { recursive: true });
  const rutaLog = join(DIR_LOGS, `remoto-tunel-${id}.log`);
  const fd = openSync(rutaLog, 'a');
  const hijo = spawn('ssh', argsTunel(config, entrada), { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  hijo.on('error', () => {});
  hijo.unref();
  closeSync(fd);
  if (!hijo.pid) return { pid: null, rutaLog };
  // [por que] Con ExitOnForwardFailure un reenvio fallido sale en < 1 s; esperar evita dar por bueno un PID muerto.
  await new Promise((r) => setTimeout(r, 1500));
  const proc = (await procesosDe([hijo.pid])).get(hijo.pid);
  if (!tunelEsNuestro(proc, config, entrada)) return { pid: null, rutaLog };
  return { pid: hijo.pid, creado: proc.creado, rutaLog };
}

async function matarTunel(pid) {
  return new Promise((resolveP) => {
    execFile('taskkill.exe', ['/F', '/PID', String(pid), '/T'], { timeout: 15_000, windowsHide: true }, (err) => resolveP(!err));
  });
}

// Túneles ssh nuestros que escuchan en los puertos locales, aunque el registro no los conozca (p. ej. tras perder el estado o un `up` desfasado).
async function tunelesNuestrosEnPuertos(config, entrada) {
  const netstat = await new Promise((resolveP) => {
    execFile('netstat.exe', ['-ano', '-p', 'TCP'], { timeout: 10_000, windowsHide: true }, (err, salida) => resolveP(err ? '' : salida));
  });
  const pids = pidsEscuchandoLocal(netstat, puertosLocalesDe(entrada));
  if (!pids.length) return [];
  const procs = await procesosDe(pids);
  return pids.filter((pid) => tunelEsNuestro(procs.get(pid), config, entrada));
}

function rutaAbsDe(entrada) {
  return isAbsolute(entrada.ruta) ? normalize(entrada.ruta) : resolve(RAIZ_REPO, entrada.ruta);
}

function rutaSonda(entrada, puerto) {
  return entrada.healths?.find((h) => h.puerto === puerto)?.ruta ?? '/';
}

async function estadoRemoto(config, id, entrada) {
  const tunel = usaTunel(entrada);
  const pidTunel = tunel ? await tunelVivo(config, entrada, leerEstado(id)) : null;
  const remotos = puertosRemotosDe(entrada);
  const r = await sshRemoto(config, comandoSesiones(remotos.map((p) => sesionTmux(id, p))));
  if (!r.ok) {
    return { estado: 'deriva', pidTunel, motivo: `sin ssh a ${config.host} (${r.error})` };
  }
  const vivas = r.salida.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const sesionesVivas = remotos.filter((p) => vivas.includes(sesionTmux(id, p)));
  // [por que] Un solo intento de 2 s daba «deriva» falso tras un arranque en frío del túnel; se reintenta hasta 3 s.
  // Sin túnel, el probe solo corre si hay sesiones: sin ellas no hay nada que sondear.
  let sondasOk = remotos.map(() => false);
  if (tunel && pidTunel) {
    sondasOk = await Promise.all(remotos.map((p, i) => esperarSonda(puertosLocalesDe(entrada)[i], rutaSonda(entrada, p), 3000)));
  } else if (!tunel && sesionesVivas.length) {
    sondasOk = await Promise.all(remotos.map((p) => esperarSondaRemota(config, p, rutaSonda(entrada, p), 3000)));
  }
  const conexion = tunel ? `tunel ${pidTunel ? `pid ${pidTunel}` : 'caido'}` : 'sin tunel';
  const detalle = `tmux ${sesionesVivas.length}/${remotos.length}, ${conexion}, probe ${sondasOk.filter(Boolean).length}/${remotos.length}`;
  if (sesionesVivas.length === remotos.length && (pidTunel || !tunel) && sondasOk.every(Boolean)) {
    return { estado: 'bajo-mando', pidTunel, motivo: `${config.host}: ${detalle}` };
  }
  if (sesionesVivas.length === 0 && !pidTunel) {
    return { estado: 'parado', pidTunel, motivo: `${config.host}: ${detalle}` };
  }
  return { estado: 'deriva', pidTunel, motivo: `${config.host}: ${detalle}` };
}

async function esperarEscucha(config, entrada, limiteMs) {
  const t0 = Date.now();
  for (;;) {
    const r = await sshRemoto(config, 'ss -ltnH');
    if (!r.ok) return { ok: false, motivo: `ss remoto fallo: ${r.error}` };
    const analisis = puertosRemotosDe(entrada).map((p) => ({ p, ...analizarEscucha(r.salida, p) }));
    const publicas = analisis.flatMap((a) => a.publicas.map((d) => `${d} (puerto ${a.p})`));
    if (publicas.length) return { ok: false, publico: true, motivo: `escucha publica en ${config.host}: ${publicas.join(', ')}` };
    if (analisis.every((a) => a.escucha)) return { ok: true };
    if (Date.now() - t0 > limiteMs) {
      const faltan = analisis.filter((a) => !a.escucha).map((a) => a.p);
      return { ok: false, motivo: `sin escucha en ${config.host} en ${limiteMs}ms (puertos ${faltan.join(',')})` };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// Build en frío (241–307 s medidos) y npm ci: más que el timeout corto de ssh.
const TIMEOUT_BUILD_MS = 900_000;

// Protocolo de arranque remoto (decidido 2026-10-14). Orden fijo; cada paso falla cerrado con su motivo:
// 1) .env local con las claves pedidas; 2) base de la rama en la 89 (si hay Cargo.toml y taller.json `bd`);
// 3) .env remoto por stdin, 0600; 4) npm ci si cambió package-lock.json; 5) precompilar bajo cm-heavy.
// Sin envRemoto no se copia nada: el proceso usa solo el env del registro.
// Entorno que debe ver el proceso remoto: registro + DATABASE_URL si hay envRemoto y BD. Solo lectura; lanza si el nombre de BD no sale del Cargo.toml.
function entornoRemoto(config, id, entrada, rama) {
  const ruta = rutaAbsDe(entrada);
  const env = { ...(entrada.env ?? {}) };
  let urlBd = null;
  let nombreBd = null;
  if (entrada.envRemoto !== undefined && config.bd && existsSync(join(ruta, 'Cargo.toml'))) {
    // [por que] Decidido 2026-10-14 (2 bases como máximo): un proyecto con bdDesdeLocal usa su base de trabajo sin sufijo de rama; `main` como rama fuerza ese nombre.
    const bdTrabajo = config.proyectos?.[id]?.bdDesdeLocal !== undefined;
    nombreBd = nombreBaseDatos(readFileSync(join(ruta, 'Cargo.toml'), 'utf8'), bdTrabajo ? 'main' : rama, config.proyectos?.[id]?.basedatos);
    urlBd = urlBaseRemota(config.bd, nombreBd);
    env.DATABASE_URL = urlBd;
  }
  return { env, urlBd, nombreBd };
}

async function prepararRemoto(config, id, entrada, rama, rutas) {
  const ruta = rutaAbsDe(entrada);
  let base;
  try {
    base = entornoRemoto(config, id, entrada, rama);
  } catch (e) {
    return { ok: false, resumen: e.message };
  }
  const { env, urlBd, nombreBd } = base;
  let contenidoEnv = null;
  if (entrada.envRemoto !== undefined) {
    const rutaEnv = join(ruta, '.env');
    let textoEnv;
    try {
      textoEnv = readFileSync(rutaEnv, 'utf8');
    } catch {
      return { ok: false, resumen: `envRemoto pide copiar ${rutaEnv} y no existe` };
    }
    const { contenido, faltan } = contenidoEnvRemoto(textoEnv, entrada.envRemoto, urlBd);
    if (faltan.length) return { ok: false, resumen: `envRemoto: faltan en ${rutaEnv}: ${faltan.join(', ')}` };
    contenidoEnv = contenido;
  }
  if (nombreBd) {
    const r = await sshRemoto(config, `bash -lc ${shQuote(comandoBaseRemota(config.bd, nombreBd))}`);
    if (!r.ok) return { ok: false, resumen: `base ${nombreBd} no disponible en ${config.host}: ${r.error}` };
  }
  if (contenidoEnv !== null) {
    const w = await escribirArchivoRemoto(config, `${rutas.dirRemoto}/.env`, contenidoEnv);
    if (!w.ok) return { ok: false, resumen: `.env remoto no se pudo escribir: ${w.error}` };
    const front = contenidoEnvFrontend(contenidoEnv);
    if (front !== null && existsSync(join(ruta, 'frontend'))) {
      const wf = await escribirArchivoRemoto(config, `${rutas.dirRemoto}/frontend/.env.local`, front);
      if (!wf.ok) return { ok: false, resumen: `frontend/.env.local remoto no se pudo escribir: ${wf.error}` };
    }
  }
  for (const sub of entrada.dependencias ?? []) {
    const r = await sshRemoto(config, comandoNpmCi(rutas.dirRemoto, rutas.dirLogs, sub, id), TIMEOUT_BUILD_MS);
    if (!r.ok) return { ok: false, resumen: `npm ci (${sub}) fallo, log ${rutaLogNpmCi(rutas.dirLogs, sub, id)} en ${config.host}` };
  }
  for (const argv of entrada.precompilar ?? []) {
    const r = await sshRemoto(config, comandoPrecompilar(config, rutas, id, argv), TIMEOUT_BUILD_MS);
    if (r.codigo === 75) return { ok: false, resumen: `cm-heavy ocupado en ${config.host} (otro build pesado); reintenta en unos minutos` };
    if (!r.ok) return { ok: false, resumen: `precompilar fallo, log ${rutas.dirLogs}/precompilar-${id}.log en ${config.host}: ${r.error}` };
  }
  return { ok: true, env, nombreBd };
}

// Puertos cuyo proceso vivo no tiene el entorno que pide el registro (otra rama, otro env). Solo lectura.
// [por que] Sin pid visible no hay forma de comprobarlo: ese puerto se reinicia en vez de darlo por bueno.
async function puertosConEntornoDistinto(config, id, entrada, rama) {
  let esperado;
  try {
    esperado = entornoRemoto(config, id, entrada, rama).env;
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
  const ss = await sshRemoto(config, 'ss -ltnpH');
  if (!ss.ok) return { ok: false, motivo: `ss remoto fallo: ${ss.error}` };
  const puertos = [];
  const detalle = [];
  for (const p of puertosRemotosDe(entrada)) {
    const pid = pidDeEscucha(ss.salida, p);
    let texto = '';
    if (pid) {
      const r = await sshRemoto(config, `tr '\\0' '\\n' < /proc/${pid}/environ`);
      texto = r.ok ? r.salida : '';
    }
    const claves = variablesDistintas(texto, esperado);
    if (!pid || claves.length) {
      puertos.push(p);
      detalle.push(pid ? `puerto ${p}: ${claves.join(', ')}` : `puerto ${p}: sin pid`);
    }
  }
  return { ok: true, puertos, detalle };
}

// Espera a que los puertos queden libres tras parar sus sesiones; si no, el arranque nuevo chocaría con el viejo.
async function esperarLibre(config, puertos, limiteMs) {
  const t0 = Date.now();
  for (;;) {
    const r = await sshRemoto(config, 'ss -ltnH');
    if (!r.ok) return { ok: false, motivo: `ss remoto fallo: ${r.error}` };
    const ocupados = puertos.filter((p) => analizarEscucha(r.salida, p).escucha);
    if (!ocupados.length) return { ok: true };
    if (Date.now() - t0 > limiteMs) return { ok: false, motivo: `puertos ${ocupados.join(',')} siguen ocupados en ${config.host} tras parar la sesion` };
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function ejecutarLocal(binario, args, env, timeoutMs) {
  return new Promise((resolveP) => {
    execFile(binario, args, { env, timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolveP({ ok: !err, salida: String(stdout ?? ''), error: String(stderr || err?.message || '').trim().slice(0, 300) });
    });
  });
}

function marcaTiempo() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

// Conteos "tabla=valor" de `psql -At`. Pura: se prueba sin base.
export function parsearConteos(texto) {
  const mapa = new Map();
  for (const linea of texto.split(/\r?\n/)) {
    const i = linea.indexOf('=');
    if (i > 0) mapa.set(linea.slice(0, i).trim(), linea.slice(i + 1).trim());
  }
  return mapa;
}

// [por que] Un conteo ausente o no numérico nunca cuenta como coincidente: solo igualdad exacta de números.
export function diferenciasConteos(local, remoto, tablas) {
  const numero = (v) => v !== undefined && /^\d+$/.test(v);
  return tablas
    .filter((t) => !(numero(local.get(t)) && numero(remoto.get(t)) && local.get(t) === remoto.get(t)))
    .map((t) => `${t}: laptop=${local.get(t) ?? 'sin conteo'}, 89=${remoto.get(t) ?? 'sin conteo'}`);
}

const DIR_DUMPS_LOCALES = 'C:/tmp/backups-bd';
const COPIAS_PREVIAS_BD = 3;

// Base de trabajo de la 89 = copia de la base de la laptop (decidido 2026-10-14: dos bases como máximo; la 89 es la de trabajo y la 66 no se toca desde aquí).
// [por que] Orden: dump local filtrado -> copia previa en la 89 (si la base existe, sin copia no se restaura) -> restauración en una transacción -> conteos iguales en ambos lados.
// La clave viaja en PGPASSWORD (entorno del proceso), nunca en argumentos ni en logs.
export async function sincronizarBd(config, id, entrada, ruta, nombreBd) {
  if (!nombreBd) return { ok: false, resumen: 'BD: el proyecto no tiene base remota (sin Cargo.toml o envRemoto)' };
  const pgDump = config.bd?.pgDumpLocal;
  if (!pgDump) return { ok: false, resumen: 'BD: taller.json bd.pgDumpLocal no declarado' };
  const tablas = config.proyectos?.[id]?.bdDesdeLocal?.verificar ?? [];
  let local;
  try {
    local = leerUrlBdLocal(readFileSync(join(ruta, '.env'), 'utf8'));
  } catch (e) {
    return { ok: false, resumen: `BD: ${e.message}` };
  }
  const envLocal = { ...process.env, PGPASSWORD: local.clave };
  const conexion = ['-h', local.host, '-p', String(local.puerto), '-U', local.usuario];

  mkdirSync(DIR_DUMPS_LOCALES, { recursive: true });
  const rutaDump = `${DIR_DUMPS_LOCALES}/${local.nombre}-sync.sql`;
  const dump = await ejecutarLocal(pgDump, [...conexion, '-Fp', '--no-owner', '--no-acl', '--clean', '--if-exists', '-f', rutaDump, local.nombre], envLocal, 600_000);
  if (!dump.ok) return { ok: false, resumen: `BD: pg_dump de la laptop fallo: ${dump.error}` };
  const sql = filtrarSqlParaPg16(readFileSync(rutaDump, 'utf8'));
  writeFileSync(rutaDump, sql);

  // [por que] escribirArchivoRemoto hace mkdir -p del directorio y deja el fichero en 0600.
  const dirDatos = `${config.dirRemotoBase}/_datos`;
  const rutaRemotaSql = `${dirDatos}/${nombreBd}-sync.sql`;
  const subida = await escribirArchivoRemoto(config, rutaRemotaSql, sql, 300_000);
  if (!subida.ok) return { ok: false, resumen: `BD: subida del dump a ${config.host} fallo: ${subida.error}` };

  const dirCopias = `${dirDatos}/copias`;
  const copiaPrevia = `${dirCopias}/${nombreBd}-previo-${marcaTiempo()}.dump`;
  const previa = await sshRemoto(config, [
    'PATH=$HOME/.local/bin:/usr/bin:/bin',
    `mkdir -p ${shQuote(dirCopias)}`,
    `existe=$(psql -X -At -d postgres -c ${shQuote(`select 1 from pg_database where datname='${nombreBd}'`)}) || { echo FALLO_COMPROBAR; exit 1; }`,
    `if [ "$existe" = 1 ]; then pg_dump -Fc -d ${shQuote(nombreBd)} -f ${shQuote(copiaPrevia)} || { rm -f ${shQuote(copiaPrevia)}; echo FALLO_PREVIA; exit 1; }; echo PREVIA_OK; else echo SIN_PREVIA; fi`,
    `ls -1t ${shQuote(dirCopias)}/${nombreBd}-previo-*.dump 2>/dev/null | tail -n +${COPIAS_PREVIAS_BD + 1} | xargs -r rm -f`,
  ].join('; '), 300_000);
  if (!previa.ok) return { ok: false, resumen: `BD: copia previa en ${config.host} fallo: ${previa.error || previa.salida.trim()}` };

  const restauracion = await sshRemoto(config, `PATH=$HOME/.local/bin:/usr/bin:/bin; psql -X -q -v ON_ERROR_STOP=1 -1 -d ${shQuote(nombreBd)} -f ${shQuote(rutaRemotaSql)}`, 600_000);
  if (!restauracion.ok) return { ok: false, resumen: `BD: restauracion en ${config.host} fallo (transaccion revertida): ${restauracion.error}` };

  const cuentaRemota = await sshRemoto(config, [
    'PATH=$HOME/.local/bin:/usr/bin:/bin',
    ...tablas.map((t) => `printf '%s=' ${shQuote(t)}; psql -X -At -d ${shQuote(nombreBd)} -c ${shQuote(`select count(*) from "${t}"`)} 2>/dev/null || echo no-existe`),
  ].join('; '), 120_000);
  if (!cuentaRemota.ok) return { ok: false, resumen: `BD: conteo en ${config.host} fallo: ${cuentaRemota.error}` };
  const cuentaLocal = new Map();
  for (const t of tablas) {
    const c = await ejecutarLocal(join(dirname(pgDump), 'psql.exe'), [...conexion, '-X', '-At', '-d', local.nombre, '-c', `select count(*) from "${t}"`], envLocal, 60_000);
    cuentaLocal.set(t, c.ok ? c.salida.trim() : 'sin conteo');
  }
  const diffs = diferenciasConteos(cuentaLocal, parsearConteos(cuentaRemota.salida), tablas);
  if (diffs.length) return { ok: false, resumen: `BD: conteos distintos tras restaurar (${diffs.join('; ')})` };
  const remota = parsearConteos(cuentaRemota.salida);
  const cuenta = tablas.map((t) => `${t}=${remota.get(t)}`).join(', ');
  return { ok: true, resumen: `BD sincronizada desde laptop${cuenta ? ` (${cuenta})` : ''}` };
}

async function upRemoto(config, id, entrada, args = []) {
  const error = validarHostRemoto(entrada, config);
  if (error) return { codigo: 1, resumen: `up ${id}: rehusado (${error})` };
  const rama = detectarRama(rutaAbsDe(entrada));
  const rutas = rutasRemotas(config, id, rama);
  // [por que] Antes del estado: si la sesión de sync se perdió, `up` la restaura aunque los procesos sigan vivos.
  const sync = asegurarSesion({ config, proyecto: id, rutaLocal: rutaAbsDe(entrada), rutas });
  if (sync !== 0) return { codigo: 1, resumen: `up ${id}: sincronizacion con ${config.host} no lista (mutagen, codigo ${sync}): NO verde` };
  const previo = await estadoRemoto(config, id, entrada);
  // [por que] Sin --sin-bd, un proyecto con base declarada (bdDesdeLocal) refresca su base al arrancar; si ya está arriba, solo con --bd.
  const forzarBd = args.includes('--bd');
  const sincronizar = config.proyectos?.[id]?.bdDesdeLocal !== undefined && !args.includes('--sin-bd') && (previo.estado !== 'bajo-mando' || forzarBd);
  let reiniciar = { puertos: [], detalle: [] };
  if (previo.estado === 'bajo-mando') {
    reiniciar = await puertosConEntornoDistinto(config, id, entrada, rama);
    if (!reiniciar.ok) return { codigo: 1, resumen: `up ${id}: ${reiniciar.motivo}: NO verde` };
    if (!reiniciar.puertos.length && !sincronizar) return { codigo: 0, resumen: `up ${id}: ya-arriba (${previo.motivo})` };
  }
  const prep = await prepararRemoto(config, id, entrada, rama, rutas);
  if (!prep.ok) return { codigo: 1, resumen: `up ${id}: ${prep.resumen}: NO verde` };
  let bdResumen = null;
  if (sincronizar) {
    // [por que] La base solo se restaura con el backend parado: se paran todas las sesiones de este proyecto antes de tocarla.
    if (previo.estado !== 'parado') {
      const parado = await pararSesiones(config, id, entrada);
      if (!parado.ok) return { codigo: 1, resumen: `up ${id}: no paro sesiones antes de sincronizar la BD en ${config.host}: ${parado.error}: NO verde` };
      const libre = await esperarLibre(config, puertosRemotosDe(entrada), 15_000);
      if (!libre.ok) return { codigo: 1, resumen: `up ${id}: ${libre.motivo}: NO verde` };
    }
    const bd = await sincronizarBd(config, id, entrada, rutaAbsDe(entrada), prep.nombreBd);
    if (!bd.ok) return { codigo: 1, resumen: `up ${id}: ${bd.resumen}: NO verde` };
    bdResumen = bd.resumen;
    // Todas las sesiones se pararon arriba: no hay nada que reiniciar por entorno.
    reiniciar = { puertos: [], detalle: [] };
  }
  if (reiniciar.puertos.length) {
    // [por que] Solo nuestras sesiones tmux de esos puertos; el túnel se conserva y el probe final lo confirma.
    const parado = await pararSesionesPuertos(config, id, reiniciar.puertos);
    if (!parado.ok) return { codigo: 1, resumen: `up ${id}: no paro sesiones con entorno distinto (${reiniciar.detalle.join('; ')}) en ${config.host}: ${parado.error}: NO verde` };
    const libre = await esperarLibre(config, reiniciar.puertos, 15_000);
    if (!libre.ok) return { codigo: 1, resumen: `up ${id}: ${libre.motivo}: NO verde` };
  }
  const remotos = puertosRemotosDe(entrada);
  for (const [i, p] of remotos.entries()) {
    const r = await sshRemoto(config, comandoRemotoUp(config, rutas, id, p, (entrada.botonRemoto ?? entrada.boton)[i], prep.env));
    if (!r.ok) return { codigo: 1, resumen: `up ${id}: arranque remoto fallo (puerto ${p}): ${r.error}` };
  }
  const limiteMs = entrada.arranqueMs ?? 60_000;
  const escucha = await esperarEscucha(config, entrada, limiteMs);
  if (!escucha.ok) {
    if (escucha.publico) await pararSesiones(config, id, entrada);
    return { codigo: 1, resumen: `up ${id}: ${escucha.motivo}: NO verde` };
  }
  let pid = null;
  let creado = null;
  if (usaTunel(entrada)) {
    pid = previo.pidTunel;
    creado = leerEstado(id)?.tunelCreado ?? null;
    if (!pid) {
      const t = await abrirTunel(config, entrada, id);
      if (!t.pid) return { codigo: 1, resumen: `up ${id}: tunel ssh no levanto o no es el nuestro (log ${t.rutaLog}): NO verde` };
      pid = t.pid;
      creado = t.creado;
    }
  }
  for (const [i, p] of remotos.entries()) {
    const ruta = rutaSonda(entrada, p);
    // [por que] Sin túnel el probe corre en la 89: es el loopback que expone cloudflared (o el propio servicio).
    const ok = usaTunel(entrada)
      ? await esperarSonda(puertosLocalesDe(entrada)[i], ruta, limiteMs)
      : await esperarSondaRemota(config, p, ruta, limiteMs);
    if (!ok) return { codigo: 1, resumen: `up ${id}: probe sin respuesta ${usaTunel(entrada) ? 'por el tunel' : `en ${config.host}`} (puerto ${p}, ${limiteMs}ms): NO verde` };
  }
  escribirEstado(id, {
    host: config.host,
    tunelPid: pid,
    tunelCreado: creado,
    puertos: remotos,
    creadoEn: new Date().toISOString(),
  });
  const reinicio = reiniciar.puertos.length ? `, reiniciados por entorno distinto: ${reiniciar.detalle.join('; ')}` : '';
  const via = pid ? `tunel pid ${pid}` : 'sin tunel';
  return { codigo: 0, resumen: `up ${id}: arrancado en ${config.host} (puertos ${remotos.join(', ')}, ${via}${reinicio})${bdResumen ? `; ${bdResumen}` : ''} + probe verde` };
}

async function statusRemoto(config, id, entrada) {
  const r = await estadoRemoto(config, id, entrada);
  return { codigo: r.estado === 'bajo-mando' || r.estado === 'parado' ? 0 : 2, estado: r.estado, motivo: r.motivo };
}

async function stopRemoto(config, id, entrada) {
  const estado = leerEstado(id);
  // [por que] Cerrar solo el PID registrado dejaba vivo el túnel real (ocupaba 3210/5299 y `up` fallaba después).
  const registrado = await tunelVivo(config, entrada, estado);
  const enPuertos = usaTunel(entrada) ? await tunelesNuestrosEnPuertos(config, entrada) : [];
  const pids = [...new Set([registrado, ...enPuertos].filter(Boolean))];
  const remoto = await pararSesiones(config, id, entrada);
  const cierres = await Promise.all(pids.map(async (pid) => ({ pid, cerrado: await matarTunel(pid) })));
  const tras = await estadoRemoto(config, id, entrada);
  const tunel = cierres.length ? cierres.map(({ pid, cerrado }) => `pid ${pid} ${cerrado ? 'cerrado' : 'no cerrado'}`).join(', ') : 'no era nuestro o ya caido';
  const nota = `remoto ${remoto.ok ? 'ok' : `fallo (${remoto.error})`}, tunel ${tunel}`;
  if (tras.estado === 'parado') {
    rmSync(rutaEstado(id), { force: true });
    return { codigo: 0, resumen: `stop ${id}: detenido (${nota}) + sin sesiones ni tunel` };
  }
  return { codigo: 1, resumen: `stop ${id}: NO verde (${nota}; ${tras.motivo})` };
}

async function logsRemoto(config, id, entrada, lineas) {
  const rutas = rutasRemotas(config, id, detectarRama(rutaAbsDe(entrada)));
  const partes = puertosRemotosDe(entrada).map((p) => `echo ${shQuote(`== ${p}`)}; tail -n ${lineas} ${shQuote(`${rutas.dirLogs}/dev-up-${id}-${p}.log`)} 2>&1`);
  const r = await sshRemoto(config, partes.join('; '));
  return r.ok ? { codigo: 0, salida: r.salida } : { codigo: 1, salida: `logs ${id}: ${r.error}` };
}

// Entrada del registro si es remota; null si no lo es o el registro no se puede leer (lo informa el camino local).
export function entradaRemotaDe(id, args) {
  if (!id || id.startsWith('-')) return null;
  // --local fuerza el camino local aunque el registro declare host (decidido 2026-10-14: todo en la 89 por defecto).
  if (args.includes('--local')) return null;
  const iReg = args.indexOf('--registro');
  let registro;
  try {
    registro = leerRegistro(iReg >= 0 ? args[iReg + 1] : undefined);
  } catch {
    return null;
  }
  const entrada = registro.entradas.get(id);
  return esEntradaRemota(entrada) ? entrada : null;
}

export async function despachar(cmd, args, entrada) {
  const id = args[0];
  const comoJson = args.includes('--json');
  const sale = (r) => {
    if (comoJson) console.log(JSON.stringify({ id, ...r }));
    else console.log(r.resumen ?? `${r.estado.padEnd(11)} ${id}  ${r.motivo}`);
    return r.codigo;
  };
  let config;
  try {
    config = cargarConfig();
  } catch (e) {
    return sale({ codigo: 1, resumen: `${cmd} ${id}: taller.json no legible (${e.message})` });
  }
  if (cmd === 'up') return sale(await upRemoto(config, id, entrada, args));
  if (cmd === 'status') return sale(await statusRemoto(config, id, entrada));
  if (cmd === 'stop') return sale(await stopRemoto(config, id, entrada));
  if (cmd === 'logs') {
    const iLin = args.indexOf('--lineas');
    const n = iLin >= 0 ? Number.parseInt(args[iLin + 1], 10) : 50;
    const lineas = Number.isInteger(n) ? Math.min(Math.max(n, 1), 200) : 50;
    const r = await logsRemoto(config, id, entrada, lineas);
    console.log(r.salida);
    return r.codigo;
  }
  return 1;
}
