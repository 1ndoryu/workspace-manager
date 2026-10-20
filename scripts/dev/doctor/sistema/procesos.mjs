/* Sensores de procesos y puertos del portatil (PowerShell/CIM sobre Windows). */

import { execFile } from 'node:child_process';

import { MAX_PIDS_CONSULTA, TIMEOUT_SENSOR_MS } from '../base.mjs';

/* Ejecuta powershell con salida UTF-8 y timeout duro. */
function correrPs(script, timeoutMs = TIMEOUT_SENSOR_MS) {
  return new Promise((resolveP, rejectP) => {
    const prefijo = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ';
    const hijo = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', prefijo + script],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          const causa = err.killed || err.signal === 'SIGTERM' ? 'timeout' : String(err.message ?? err).slice(0, 160);
          rejectP(new Error(`powershell fallo (${causa})`));
          return;
        }
        resolveP(stdout);
      },
    );
    void hijo;
  });
}


/* Ejecuta un binario nativo (sin shell) con timeout duro; devuelve stdout. */
function correrCmd(exe, args, timeoutMs = TIMEOUT_SENSOR_MS) {
  return new Promise((resolveP, rejectP) => {
    execFile(exe, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) {
        const causa = err.killed || err.signal === 'SIGTERM' ? 'timeout' : String(err.message ?? err).slice(0, 160);
        rejectP(new Error(`${exe} fallo (${causa})`));
        return;
      }
      resolveP(stdout);
    });
  });
}


/* Puertos escuchando TCP, atribuibles al area por proceso. Usa `netstat -ano`
 * y no Get-NetTCPConnection: ese cmdlet tardo 40 s medidos (2026-10-10) y
 * superaba el timeout del sensor, dejando `status`/`up` en "sensor fallo".
 * Solo binds explicitos loopback (127.0.0.1/::1) + 0.0.0.0/[::] atribuibles
 * al area por proceso (los binds globales de servicios del sistema quedan
 * fuera de alcance declarado). */
export async function escanearEscucha() {
  return (await escanearSockets()).escucha;
}

/* Listeners y conexiones establecidas en UNA sola llamada a netstat. */
export async function escanearSockets() {
  // [por que] Sin `-p TCP`: en Windows ese filtro omite los listeners IPv6 ([::1]:5176).
  const sal = await correrCmd('netstat.exe', ['-ano']);
  return { escucha: parsearNetstat(sal), establecidas: parsearEstablecidas(sal) };
}

// Puro (testeable): filas `TCP <local> <remoto> LISTENING <pid>` de `netstat -ano`.

export function parsearNetstat(sal) {
  const filas = [];
  for (const linea of sal.split(/\r?\n/)) {
    const t = linea.trim().split(/\s+/);
    if (t.length !== 5 || t[0] !== 'TCP' || !/LISTEN/i.test(t[3])) continue;
    // [por que] Direccion local IPv6 viene entre corchetes: [::1]:5174.
    const corte = t[1].lastIndexOf(':');
    const ip = t[1].slice(0, corte).replace(/^\[|\]$/g, '');
    const puerto = Number(t[1].slice(corte + 1));
    const pid = Number(t[4]);
    if (Number.isInteger(puerto) && Number.isInteger(pid)) filas.push({ ip, puerto, pid });
  }
  return filas;
}

/* Puro (testeable): conexiones ESTABLISHED con el puerto remoto y el pid dueño de
 * la fila. [por que] En la fila del CLIENTE el puerto remoto es el listener, así
 * que su pid dice quién lo usa: el túnel de BD de un proyecto no tiene dueño
 * legible (CIM oculto) pero sí su backend como cliente. */
export function parsearEstablecidas(sal) {
  const filas = [];
  for (const linea of sal.split(/\r?\n/)) {
    const t = linea.trim().split(/\s+/);
    if (t.length !== 5 || t[0] !== 'TCP' || t[3] !== 'ESTABLISHED') continue;
    const puertoRemoto = Number(t[2].slice(t[2].lastIndexOf(':') + 1));
    const pid = Number(t[4]);
    if (Number.isInteger(puertoRemoto) && Number.isInteger(pid)) filas.push({ puertoRemoto, pid });
  }
  return filas;
}


/* Datos CIM en UNA sola llamada a powershell.exe (cada arranque cuesta ~0,6 s):
 * procesos (CreationDate ISO, ExecutablePath, CommandLine) y, si se piden, los
 * servicios Win32_Service (su exe no es legible sin elevar, el nombre si).
 * Sin CommandLine visible (elevados) el proceso NO es confiable: se marca,
 * nunca se da por bueno. */
export async function datosCimDe(pids, { servicios: conServicios = false } = {}) {
  const unicos = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0);
  const procs = new Map();
  const servicios = new Map();
  if (unicos.length === 0) return { procs, servicios };
  // [por que] Un solo filtro CIM largo devuelve un subconjunto SIN error y
  // los PIDs recortados quedarian NO-VERIFICADO en silencio. Trozos de 20
  // como consultas sucesivas dentro del MISMO proceso de PowerShell: completo
  // sin sacrificar el tope por consulta ni pagar un arranque por trozo.
  const consultas = [];
  for (let i = 0; i < unicos.length; i += MAX_PIDS_CONSULTA) {
    const filtro = unicos
      .slice(i, i + MAX_PIDS_CONSULTA)
      .map((p) => `ProcessId=${p}`)
      .join(' OR ');
    consultas.push(
      `$procesos += @(Get-CimInstance Win32_Process -Filter "${filtro}" | Select-Object @{n='pid';e={$_.ProcessId}},@{n='creado';e={$_.CreationDate.ToString('o')}},@{n='exe';e={$_.ExecutablePath}},@{n='cmd';e={$_.CommandLine}},@{n='imagen';e={$_.Name}})`,
    );
  }
  if (conServicios) {
    consultas.push(
      `$servicios = @(Get-CimInstance Win32_Service -Filter "ProcessId > 0" | Select-Object @{n='pid';e={$_.ProcessId}},@{n='nombre';e={$_.Name}})`,
    );
  }
  const script = `$procesos = @(); ${consultas.join('; ')}; [pscustomobject]@{ procesos = $procesos; servicios = $servicios } | ConvertTo-Json -Compress -Depth 3`;
  // Presupuesto igual al de antes: 25 s por consulta, ahora dentro de una sola llamada.
  const sal = await correrPs(script, TIMEOUT_SENSOR_MS * consultas.length);
  let j;
  try {
    j = JSON.parse(sal);
  } catch {
    throw new Error('sensor procesos/servicios: JSON inesperado de Get-CimInstance');
  }
  const filas = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  for (const f of filas(j?.procesos)) {
    if (!Number.isInteger(f?.pid)) continue;
    // [por que] `imagen` (Name) llega aunque exe/cmd vengan nulos (proceso elevado o protegido).
    procs.set(f.pid, { creado: f.creado ?? null, exe: f.exe ?? null, cmd: f.cmd ?? null, imagen: f.imagen ?? null });
  }
  if (conServicios) {
    const buscados = new Set(unicos);
    for (const f of filas(j?.servicios)) {
      if (buscados.has(f?.pid)) servicios.set(f.pid, { nombre: f.nombre ?? null });
    }
  }
  return { procs, servicios };
}


/* Procesos de los PIDs dados (CreationDate, exe, cmd). */
export async function procesosDe(pids) {
  return (await datosCimDe(pids)).procs;
}


/* Todos los ssh vivos (CreationDate, exe, cmd): los túneles de las fichas remotas.
 * [por que] Fail-open: si el sensor falla devuelve [] y el listener sigue
 * visible como huérfano, nunca se oculta por error. */
export async function procesosSshVivos() {
  const script = `@(Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Select-Object @{n='pid';e={$_.ProcessId}},@{n='creado';e={$_.CreationDate.ToString('o')}},@{n='exe';e={$_.ExecutablePath}},@{n='cmd';e={$_.CommandLine}},@{n='imagen';e={$_.Name}}) | ConvertTo-Json -Compress -Depth 3`;
  try {
    const sal = (await correrPs(script)).trim();
    const j = sal ? JSON.parse(sal) : [];
    return (Array.isArray(j) ? j : [j]).map((f) => ({ creado: f.creado ?? null, exe: f.exe ?? null, cmd: f.cmd ?? null, imagen: f.imagen ?? null }));
  } catch {
    return [];
  }
}


/* Mismos datos que datosCimDe y procesosSshVivos, leídos del snapshot que escribe el servidor
 * (sistema local compartido con el taller). Sin PowerShell ni netstat propios.
 * [por que] Los servicios no vienen en el filtro por PID: se sirven del snapshot tal cual. */
export function sensoresDeSistema(sistema, pids) {
  const buscados = new Set(pids);
  const procs = new Map();
  for (const f of sistema.procesos ?? []) {
    if (buscados.has(f.pid)) procs.set(f.pid, { creado: f.creado ?? null, exe: f.exe ?? null, cmd: f.cmd ?? null, imagen: f.imagen ?? null });
  }
  const servicios = new Map();
  for (const f of sistema.servicios ?? []) {
    if (buscados.has(f.pid)) servicios.set(f.pid, { nombre: f.nombre ?? null });
  }
  return { procs, servicios };
}

/* ssh.exe vivos del snapshot (túneles de las fichas remotas), con la forma de procesosSshVivos. */
export function sshDeSistema(sistema) {
  return (sistema.procesos ?? [])
    .filter((f) => String(f.imagen ?? '').toLowerCase() === 'ssh.exe')
    .map((f) => ({ creado: f.creado ?? null, exe: f.exe ?? null, cmd: f.cmd ?? null, imagen: f.imagen ?? null }));
}

function normalizarRuta(r) {
  return String(r ?? '').replace(/\//g, '\\').toLowerCase();
}

export { normalizarRuta };

