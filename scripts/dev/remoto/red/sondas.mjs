/* Sondas de salud: HTTP local y remoto, y lectura de la escucha (ss/netstat). */

import { puertosRemotosDe } from '../../doctor.mjs';
import http from 'node:http';

import { comandoSondaRemota } from '../comandos.mjs';
import { sshRemoto } from './ssh.mjs';

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


function sondear(puerto, ruta = '/', timeoutMs = 2000, marcador = null) {
  return new Promise((resolveP) => {
    const req = http.get({ host: '127.0.0.1', port: puerto, path: ruta, timeout: timeoutMs }, (res) => {
      // [por que] Con marcador hay que leer el cuerpo; sin él basta el código. El tope de 64 KB
      // acota la memoria: el index.html de una SPA son ~1 KB y la API responde JSON pequeño.
      let cuerpo = '';
      res.on('data', (t) => {
        cuerpo += t;
        if (cuerpo.length > 64 * 1024) req.destroy();
      });
      res.on('end', () => resolveP(res.statusCode === 200 && (!marcador || cuerpo.includes(marcador))));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolveP(false));
  });
}


export async function esperarSonda(puerto, ruta, limiteMs, marcador = null) {
  const t0 = Date.now();
  while (!(await sondear(puerto, ruta, 2000, marcador))) {
    if (Date.now() - t0 > limiteMs) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return true;
}

// Sin túnel, el probe corre en la 89 contra su loopback, con el mismo criterio que sondear.
// [por que] La salida es el código HTTP; el código de salida de curl no se usa (000 = sin respuesta).

export async function esperarSondaRemota(config, puerto, ruta, limiteMs, marcador = null) {
  const t0 = Date.now();
  for (;;) {
    const r = await sshRemoto(config, comandoSondaRemota(puerto, ruta, marcador), 10_000);
    if (r.salida.trim() === '200') return true;
    if (Date.now() - t0 > limiteMs) return false;
    await new Promise((res) => setTimeout(res, 1000));
  }
}

// codigo: el de salida remoto (p. ej. 75 = cm-heavy ocupado); 1 si ssh no llegó a ejecutar o expiró el timeout.

export async function esperarEscucha(config, entrada, limiteMs) {
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

export async function esperarLibre(config, puertos, limiteMs) {
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

