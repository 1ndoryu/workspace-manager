/* Entorno de arranque remoto: validacion de la ficha y generacion de los .env. */

import { nombreBaseDatos, urlBaseRemota } from '../../remoto/rcargo.mjs';
import { MODOS, PUERTOS_PROTEGIDOS, entradaEfectiva, modoDe, puertosRemotosDe } from '../doctor.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { rutaAbsDe } from './rutaLocal.mjs';

function validarBloqueBuild(b) {
  if (typeof b !== 'object' || b === null) return 'modo build sin bloque build en la ficha';
  if (!Array.isArray(b.puertos) || b.puertos.length === 0) return 'build.puertos: lista de puertos, no vacía';
  if (!Array.isArray(b.boton) || b.boton.length !== b.puertos.length) return 'build.boton debe tener un comando por puerto';
  return null;
}

// [por que] Los nombres de variable van sin entrecomillar en el shell remoto y en el .env: solo identificadores.

const RE_NOMBRE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;

const dependenciaSegura = (d) => typeof d === 'string' && d !== '' && !isAbsolute(d) && !d.split(/[\\/]/).includes('..');

// Solo el host declarado en taller.json; sin requiere (no hay orquestacion remota de dependencias).
// `override` (--dev/--build) elige qué bloque se valida: el del modo efectivo, nunca los dos.

export function validarHostRemoto(entrada, config, override) {
  const modo = modoDe(entrada, override);
  if (!MODOS.has(modo)) return `modo '${modo}' no valido (dev|build)`;
  if (modo === 'build') {
    const mal = validarBloqueBuild(entrada.build);
    if (mal) return mal;
  }
  // A partir de aqui se valida el bloque del modo efectivo, que en dev es la entrada intacta.
  entrada = entradaEfectiva(entrada, modo);
  if (entrada.host !== config.host) return `host '${entrada.host}' no permitido (solo '${config.host}')`;
  if (entrada.requiere?.length) return 'requiere no se soporta en host remoto';
  const remotos = puertosRemotosDe(entrada);
  // [por que] Lista vacía = proyecto sin servicio (solo análisis/tests en la 89): sin puertos, su réplica es lo que se sirve.
  if (!Array.isArray(remotos) || remotos.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535)) {
    return 'puertos remotos: lista de puertos (1024-65535); [] = solo análisis';
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

// [18AA-1] Con `autologinDev` se añade `VITE_DEV_AUTOLOGIN=1`: es la bandera que enciende la
// auto-entrada del front cuando no hay `import.meta.env.DEV` (modo build). Solo la pide la ficha
// que la quiere (`build.autologinDev`), y el build de producción no pasa por aquí.

export function contenidoEnvFrontend(contenidoEnv, autologinDev = false) {
  const claves = contenidoEnv
    .split(/\r?\n/)
    .filter((l) => /^\s*(?:export\s+)?VITE_[A-Za-z0-9_]*\s*=/.test(l))
    // [por que] La bandera la pone este archivo: si el `.env` ya la trajera, saldría dos veces.
    .filter((l) => !autologinDev || !/^\s*(?:export\s+)?VITE_DEV_AUTOLOGIN\s*=/.test(l));
  if (autologinDev) claves.push('VITE_DEV_AUTOLOGIN=1');
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

export function entornoRemoto(config, id, entrada, rama) {
  const ruta = rutaAbsDe(entrada);
  const env = { ...(entrada.env ?? {}) };
  let urlBd = null;
  let nombreBd = null;
  if (entrada.envRemoto !== undefined && config.bd && existsSync(join(ruta, 'Cargo.toml'))) {
    // [por que] Decidido 2026-10-14 (2 bases como máximo): un proyecto con bdDesdeLocal usa su base de trabajo sin sufijo de rama; `main` como rama fuerza ese nombre.
    const bdTrabajo = config.proyectos?.[id]?.bdDesdeLocal !== undefined;
    nombreBd = nombreBaseDatos(readFileSync(join(ruta, 'Cargo.toml'), 'utf8'), bdTrabajo ? 'main' : rama, config.proyectos?.[id]?.basedatos);
    /* Workspace virtual (`[workspace]` sin `[package]`, la app de escritorio): no hay BD y por
     * tanto no se toca `DATABASE_URL`, que además no consumiría nadie. */
    if (nombreBd !== null) {
      urlBd = urlBaseRemota(config.bd, nombreBd);
      env.DATABASE_URL = urlBd;
    }
  }
  return { env, urlBd, nombreBd };
}

// Construye el front en la 89 y comprueba que dejó el `dist`. En build el backend sirve ese
// directorio, así que un `dist` viejo o ausente es un verde fingido: aquí se aborta en claro.
