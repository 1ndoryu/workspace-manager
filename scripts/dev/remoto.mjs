/* F3 taller remoto (VPS 89): una entrada del registro con `host` corre en la VPS,
 * en una sesion tmux por puerto, y el laptop solo mantiene un tunel SSH hacia
 * 127.0.0.1. Diseno: Agente/planes/plan-taller-remoto-vps89-2026-10-14.md.
 * [por que] El mando local no ve procesos remotos: la verdad es la sesion tmux
 * (en 89) y el PID del tunel (local, validado por creationTime e imagen/cmdline).
 * Sin probe por el tunel no hay verde; un puerto escuchando fuera de loopback
 * en 89 se mata antes de exponer nada. */
import { execFile, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import { argsSsh, cargarConfig, detectarRama, rutasRemotas, shQuote } from '../remoto/rcargo.mjs';
import { leerRegistro, procesosDe, PUERTOS_PROTEGIDOS, RAIZ_REPO } from './doctor.mjs';

const DIR_LOGS = join(RAIZ_REPO, 'logs');
const rutaEstado = (id) => join(DIR_LOGS, `remoto-${id}.json`);
const sesionTmux = (id, puerto) => `dev-${id}-${puerto}`;
const fragmentoReenvio = (puerto) => `127.0.0.1:${puerto}:127.0.0.1:${puerto}`;

export function esEntradaRemota(entrada) {
  return typeof entrada?.host === 'string' && entrada.host !== '';
}

// Solo el host declarado en taller.json; sin requiere (no hay orquestacion remota de dependencias).
export function validarHostRemoto(entrada, config) {
  if (entrada.host !== config.host) return `host '${entrada.host}' no permitido (solo '${config.host}')`;
  if (entrada.requiere?.length) return 'requiere no se soporta en host remoto';
  const protegidos = entrada.puertos.filter((p) => PUERTOS_PROTEGIDOS.has(p));
  if (protegidos.length) return `puertos protegidos ${protegidos.join(',')} no se reenvian al laptop`;
  return null;
}

// Reenvio solo a loopback en ambos extremos; ExitOnForwardFailure hace que ssh salga si un puerto no se puede reenviar.
// ControlMaster=no: el PID de este proceso es el tunel (con multiplexado ssh delegaria y saldria).
export function argsTunel(config, entrada) {
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    ...entrada.puertos.flatMap((p) => ['-L', fragmentoReenvio(p)]),
    config.host,
  ];
}

// Para `expectedCmdline` del registro (fragmentos por puerto): doctor atribuye el tunel ssh como propio.
export function marcadorTunel(config, entrada) {
  return [config.host, ...entrada.puertos.map(fragmentoReenvio)];
}

export function tunelEsNuestro(proc, config, entrada) {
  if (!proc?.creado || !proc.cmd) return false;
  if (!/^ssh(\.exe)?$/i.test(proc.imagen ?? '')) return false;
  return marcadorTunel(config, entrada).every((f) => proc.cmd.includes(f));
}

// Una sesion tmux por puerto. Idempotente: si la sesion ya existe, no hace nada.
// cm-heavy solo delante de cargo (lock de carga pesada de la VPS, §5 del taller).
export function comandoRemotoUp(config, rutas, id, puerto, boton) {
  const log = `${rutas.dirRemoto}/logs/dev-up-${id}-${puerto}.log`;
  const [exe, ...resto] = boton;
  const argv = exe === 'cargo' ? [config.lockWrapper, exe, ...resto] : boton;
  const interno = `CARGO_TARGET_DIR=${shQuote(rutas.target)} ${argv.map(shQuote).join(' ')} >> ${shQuote(log)} 2>&1`;
  const sesion = sesionTmux(id, puerto);
  return [
    `mkdir -p ${shQuote(`${rutas.dirRemoto}/logs`)}`,
    `(tmux has-session -t ${shQuote(sesion)} 2>/dev/null || tmux new-session -d -s ${shQuote(sesion)} -c ${shQuote(rutas.dirRemoto)} ${shQuote(`bash -lc ${shQuote(interno)}`)})`,
  ].join(' && ');
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

function sshRemoto(config, comando, timeoutMs = 30_000) {
  return new Promise((resolveP) => {
    execFile('ssh', argsSsh(config, [comando]), { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolveP({
        ok: !err,
        salida: String(stdout ?? ''),
        error: String(stderr || err?.message || '').trim().slice(0, 300),
      });
    });
  });
}

function comandoSesiones(sesiones) {
  return sesiones.map((s) => `if tmux has-session -t ${shQuote(s)} 2>/dev/null; then echo ${shQuote(s)}; fi`).join('; ');
}

// Pide Ctrl-C y luego mata la sesion. Si ssh falla, lo devuelve: el tunel se cierra igual.
function pararSesiones(config, id, entrada) {
  const comando = entrada.puertos
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
  const r = await sshRemoto(config, comandoSesiones(entrada.puertos.map((p) => sesionTmux(id, p))));
  if (!r.ok) {
    return { estado: 'deriva', pidTunel, motivo: `sin ssh a ${config.host} (${r.error})` };
  }
  const vivas = r.salida.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const sesionesVivas = entrada.puertos.filter((p) => vivas.includes(sesionTmux(id, p)));
  const sondasOk = pidTunel
    ? await Promise.all(entrada.puertos.map((p) => sondear(p, rutaSonda(entrada, p))))
    : entrada.puertos.map(() => false);
  const detalle = `tmux ${sesionesVivas.length}/${entrada.puertos.length}, tunel ${pidTunel ? `pid ${pidTunel}` : 'caido'}, probe ${sondasOk.filter(Boolean).length}/${entrada.puertos.length}`;
  if (sesionesVivas.length === entrada.puertos.length && pidTunel && sondasOk.every(Boolean)) {
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
    const analisis = entrada.puertos.map((p) => ({ p, ...analizarEscucha(r.salida, p) }));
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

async function upRemoto(config, id, entrada) {
  const error = validarHostRemoto(entrada, config);
  if (error) return { codigo: 1, resumen: `up ${id}: rehusado (${error})` };
  const previo = await estadoRemoto(config, id, entrada);
  if (previo.estado === 'bajo-mando') {
    return { codigo: 0, resumen: `up ${id}: ya-arriba (${previo.motivo})` };
  }
  const rutas = rutasRemotas(config, id, detectarRama(rutaAbsDe(entrada)));
  for (const [i, p] of entrada.puertos.entries()) {
    const r = await sshRemoto(config, comandoRemotoUp(config, rutas, id, p, entrada.boton[i]));
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
  for (const p of entrada.puertos) {
    if (!(await esperarSonda(p, rutaSonda(entrada, p), limiteMs))) {
      return { codigo: 1, resumen: `up ${id}: probe sin respuesta por el tunel (puerto ${p}, ${limiteMs}ms): NO verde` };
    }
  }
  escribirEstado(id, {
    host: config.host,
    tunelPid: pid,
    tunelCreado: creado,
    puertos: entrada.puertos,
    creadoEn: new Date().toISOString(),
  });
  return { codigo: 0, resumen: `up ${id}: arrancado en ${config.host} (puertos ${entrada.puertos.join(', ')}, tunel pid ${pid}) + probe verde` };
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
  const partes = entrada.puertos.map((p) => `echo ${shQuote(`== ${p}`)}; tail -n ${lineas} ${shQuote(`${rutas.dirRemoto}/logs/dev-up-${id}-${p}.log`)} 2>&1`);
  const r = await sshRemoto(config, partes.join('; '));
  return r.ok ? { codigo: 0, salida: r.salida } : { codigo: 1, salida: `logs ${id}: ${r.error}` };
}

// Entrada del registro si es remota; null si no lo es o el registro no se puede leer (lo informa el camino local).
export function entradaRemotaDe(id, args) {
  if (!id || id.startsWith('-')) return null;
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
