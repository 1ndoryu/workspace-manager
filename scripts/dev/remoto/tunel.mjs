/* Tunel SSH del laptop a la VPS: args, marcador, identidad y ciclo de vida. */

import { procesosDe, puertosRemotosDe, reenviosTunel } from '../doctor.mjs';
import { execFile, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

import { DIR_LOGS } from './estado.mjs';
import { pidsEscuchandoLocal } from './sondas.mjs';

const fragmentoReenvio = (local, remoto) => `127.0.0.1:${local}:127.0.0.1:${remoto}`;
// [por que] `puertosRemotosDe`/`localesDeModo` vienen de doctor.mjs (una sola definicion). Todo el
// flujo remoto usa `puertosRemotosDe`: puertos que escucha la VPS cuando difieren de `puertos`.
// [por que] puertosLocales (opcional, misma longitud que los remotos): el túnel abre ese puerto en el laptop y deja el remoto igual.
// Permite tener el dev local encendido sin chocar con el remoto; el resto del flujo (probe, marcador) usa el local.

export const puertosLocalesDe = (entrada) => puertosRemotosDe(entrada).map((p, i) => entrada.puertosLocales?.[i] ?? p);
// [por que] tunelSsh (opcional, true por defecto): false = la VPS expone sus puertos sola (Cloudflare Tunnel en la 89); el laptop no reenvía nada y el probe corre en la 89.

export const usaTunel = (entrada) => entrada.tunelSsh !== false;

/* `esEntradaRemota`, `MODO_POR_DEFECTO`, `MODOS`, `modoDe` y `entradaEfectiva`
 * se importan de doctor.mjs y se reexportan arriba: una sola definicion. */

// Lo mínimo para que `entradaEfectiva` dé algo arrancable; el resto lo comprueba el doctor sobre el
// registro entero (`build.healths`, `marcador`, claves del bloque).

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

// Túnel nuestro que ocupa un puerto local del proyecto aunque su forma no sea la del modo efectivo:
// al cambiar de modo (dev → build) el túnel viejo tiene un reenvío de más y `tunelEsNuestro` lo
// rechaza, pero rechazarlo no lo mata: se queda huérfano ocupando justo el puerto local que `up`
// necesita, y el `ExitOnForwardFailure` del túnel nuevo hace fallar el arranque. Esto lo identifica
// para poder cerrarlo. Solo mira reenvíos a loopback del propio host, así que no toca túneles ajenos.
// [por que] El bind explícito es opcional (`-L 3110:127.0.0.1:3110` es lo mismo que
// `-L 127.0.0.1:3110:127.0.0.1:3110`): exigirlo dejaba huérfano justo el túnel que había que cerrar,
// que es el caso real del cambio de modo de MN.

export function tunelDePuertosNuestros(proc, config, locales, remotos = locales) {
  if (!proc?.creado || !proc.cmd) return false;
  if (!/^ssh(\.exe)?$/i.test(proc.imagen ?? '')) return false;
  if (!proc.cmd.includes(config.host)) return false;
  const reenvios = reenviosTunel(proc.cmd);
  if (!reenvios.length) return false;
  return reenvios.every(([l, r]) => locales.includes(l) && remotos.includes(r));
}

// cm-heavy (lock de carga pesada de la VPS, §5 del taller) solo al compilar: decidido 2026-10-14.
// [por que] El candado dura lo que dura el build, no la vida del servidor; por eso `cargo` en `boton` exige `precompilar` (validarHostRemoto).

export async function tunelVivo(config, entrada, estado) {
  if (!estado?.tunelPid) return null;
  const proc = (await procesosDe([estado.tunelPid])).get(estado.tunelPid);
  if (!proc || proc.creado !== estado.tunelCreado || !tunelEsNuestro(proc, config, entrada)) return null;
  return estado.tunelPid;
}


export async function abrirTunel(config, entrada, id) {
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


export async function matarTunel(pid) {
  return new Promise((resolveP) => {
    execFile('taskkill.exe', ['/F', '/PID', String(pid), '/T'], { timeout: 15_000, windowsHide: true }, (err) => resolveP(!err));
  });
}

// Túneles ssh nuestros que escuchan en esos puertos locales, aunque el registro no los conozca (p. ej.
// tras perder el estado, un `up` desfasado o un cambio de modo, que cambia el número de reenvíos).
// `remotos` acota el otro extremo del reenvío: sin él, un túnel ajeno a un puerto del mismo número
// pasaría por nuestro.

export async function tunelesNuestrosEnPuertos(config, locales, remotos = locales) {
  const netstat = await new Promise((resolveP) => {
    execFile('netstat.exe', ['-ano', '-p', 'TCP'], { timeout: 10_000, windowsHide: true }, (err, salida) => resolveP(err ? '' : salida));
  });
  const pids = pidsEscuchandoLocal(netstat, locales);
  if (!pids.length) return [];
  const procs = await procesosDe(pids);
  return pids.filter((pid) => tunelDePuertosNuestros(procs.get(pid), config, locales, remotos));
}

