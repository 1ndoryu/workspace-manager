/* F3 taller remoto (VPS 89): una entrada del registro con `host` corre en la VPS,
 * en una sesion tmux por puerto, y el laptop solo mantiene un tunel SSH hacia
 * 127.0.0.1. Diseno: Agente/planes/plan-taller-remoto-vps89-2026-10-14.md.
 * [por que] El mando local no ve procesos remotos: la verdad es la sesion tmux
 * (en 89) y el PID del tunel (local, validado por creationTime e imagen/cmdline).
 * Sin probe por el tunel no hay verde; un puerto escuchando fuera de loopback
 * en 89 se mata antes de exponer nada. */
import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { isAbsolute, join, normalize, resolve } from 'node:path';
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
  return marcadorTunel(config, entrada).every((f) => proc.cmd.includes(f));
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
  const comando = puertosRemotosDe(entrada)
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

function rutaAbsDe(entrada) {
  return isAbsolute(entrada.ruta) ? normalize(entrada.ruta) : resolve(RAIZ_REPO, entrada.ruta);
}

function rutaSonda(entrada, puerto) {
  return entrada.healths?.find((h) => h.puerto === puerto)?.ruta ?? '/';
}

async function estadoRemoto(config, id, entrada) {
  const pidTunel = await tunelVivo(config, entrada, leerEstado(id));
  const remotos = puertosRemotosDe(entrada);
  const r = await sshRemoto(config, comandoSesiones(remotos.map((p) => sesionTmux(id, p))));
  if (!r.ok) {
    return { estado: 'deriva', pidTunel, motivo: `sin ssh a ${config.host} (${r.error})` };
  }
  const vivas = r.salida.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const sesionesVivas = remotos.filter((p) => vivas.includes(sesionTmux(id, p)));
  // [por que] Un solo intento de 2 s daba «deriva» falso tras un arranque en frío del túnel; se reintenta hasta 3 s.
  const sondasOk = pidTunel
    ? await Promise.all(remotos.map((p, i) => esperarSonda(puertosLocalesDe(entrada)[i], rutaSonda(entrada, p), 3000)))
    : remotos.map(() => false);
  const detalle = `tmux ${sesionesVivas.length}/${remotos.length}, tunel ${pidTunel ? `pid ${pidTunel}` : 'caido'}, probe ${sondasOk.filter(Boolean).length}/${remotos.length}`;
  if (sesionesVivas.length === remotos.length && pidTunel && sondasOk.every(Boolean)) {
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
async function prepararRemoto(config, id, entrada, rama, rutas) {
  const ruta = rutaAbsDe(entrada);
  const env = { ...(entrada.env ?? {}) };
  let urlBd = null;
  let nombreBd = null;
  if (entrada.envRemoto !== undefined && config.bd && existsSync(join(ruta, 'Cargo.toml'))) {
    try {
      nombreBd = nombreBaseDatos(readFileSync(join(ruta, 'Cargo.toml'), 'utf8'), rama, config.proyectos?.[id]?.basedatos);
    } catch (e) {
      return { ok: false, resumen: e.message };
    }
    urlBd = urlBaseRemota(config.bd, nombreBd);
    env.DATABASE_URL = urlBd;
  }
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
  return { ok: true, env };
}

async function upRemoto(config, id, entrada) {
  const error = validarHostRemoto(entrada, config);
  if (error) return { codigo: 1, resumen: `up ${id}: rehusado (${error})` };
  const rama = detectarRama(rutaAbsDe(entrada));
  const rutas = rutasRemotas(config, id, rama);
  // [por que] Antes del estado: si la sesión de sync se perdió, `up` la restaura aunque los procesos sigan vivos.
  const sync = asegurarSesion({ config, proyecto: id, rutaLocal: rutaAbsDe(entrada), rutas });
  if (sync !== 0) return { codigo: 1, resumen: `up ${id}: sincronizacion con ${config.host} no lista (mutagen, codigo ${sync}): NO verde` };
  const previo = await estadoRemoto(config, id, entrada);
  if (previo.estado === 'bajo-mando') {
    return { codigo: 0, resumen: `up ${id}: ya-arriba (${previo.motivo})` };
  }
  const prep = await prepararRemoto(config, id, entrada, rama, rutas);
  if (!prep.ok) return { codigo: 1, resumen: `up ${id}: ${prep.resumen}: NO verde` };
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
  let pid = previo.pidTunel;
  let creado = leerEstado(id)?.tunelCreado ?? null;
  if (!pid) {
    const t = await abrirTunel(config, entrada, id);
    if (!t.pid) return { codigo: 1, resumen: `up ${id}: tunel ssh no levanto o no es el nuestro (log ${t.rutaLog}): NO verde` };
    pid = t.pid;
    creado = t.creado;
  }
  for (const [i, p] of remotos.entries()) {
    if (!(await esperarSonda(puertosLocalesDe(entrada)[i], rutaSonda(entrada, p), limiteMs))) {
      return { codigo: 1, resumen: `up ${id}: probe sin respuesta por el tunel (puerto ${p}, ${limiteMs}ms): NO verde` };
    }
  }
  escribirEstado(id, {
    host: config.host,
    tunelPid: pid,
    tunelCreado: creado,
    puertos: remotos,
    creadoEn: new Date().toISOString(),
  });
  return { codigo: 0, resumen: `up ${id}: arrancado en ${config.host} (puertos ${remotos.join(', ')}, tunel pid ${pid}) + probe verde` };
}

async function statusRemoto(config, id, entrada) {
  const r = await estadoRemoto(config, id, entrada);
  return { codigo: r.estado === 'bajo-mando' || r.estado === 'parado' ? 0 : 2, estado: r.estado, motivo: r.motivo };
}

async function stopRemoto(config, id, entrada) {
  const estado = leerEstado(id);
  const pid = await tunelVivo(config, entrada, estado);
  const remoto = await pararSesiones(config, id, entrada);
  const tunel = pid ? (await matarTunel(pid)) : null;
  const tras = await estadoRemoto(config, id, entrada);
  const nota = `remoto ${remoto.ok ? 'ok' : `fallo (${remoto.error})`}, tunel ${pid ? (tunel ? `pid ${pid} cerrado` : `pid ${pid} no cerrado`) : 'no era nuestro o ya caido'}`;
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
  if (cmd === 'up') return sale(await upRemoto(config, id, entrada));
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
