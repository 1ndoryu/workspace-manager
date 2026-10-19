/* Ciclo de vida remoto: preparar, up, status, stop y logs. */

import { asegurarSesion, comandoBaseRemota, detectarRama, rutasRemotas, shQuote } from '../../remoto/rcargo.mjs';
import { entradaEfectiva, modoDe, puertosRemotosDe } from '../doctor.mjs';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { sincronizarBd } from './bd.mjs';
import { comandoConstruirFront, comandoNpmCi, comandoPrecompilar, comandoRemotoUp, rutaLogNpmCi } from './comandos.mjs';
import { contenidoEnvFrontend, contenidoEnvRemoto, entornoRemoto, validarHostRemoto } from './entorno.mjs';
import { escribirEstado, leerEstado, rutaEstado } from './estado.mjs';
import { estadoRemoto, localesTodos, marcadorSonda, pararSesiones, pararSesionesPuertos, puertosConEntornoDistinto, puertosTodos, rutaSonda } from './ficha.mjs';
import { rutaAbsDe } from './rutaLocal.mjs';
import { esperarEscucha, esperarLibre, esperarSonda, esperarSondaRemota } from './sondas.mjs';
import { escribirArchivoRemoto, sshRemoto } from './ssh.mjs';
import { abrirTunel, matarTunel, puertosLocalesDe, tunelVivo, tunelesNuestrosEnPuertos, usaTunel } from './tunel.mjs';

const TIMEOUT_BUILD_MS = 900_000;
// Dónde deja el front construido `npm run build` en los seis proyectos del taller. Es el directorio
// que sirve el backend en modo build, así que su `index.html` es la prueba de que el build cuajó.

const DIST_FRONT = 'frontend/dist';

// Protocolo de arranque remoto (decidido 2026-10-14). Orden fijo; cada paso falla cerrado con su motivo:
// 1) .env local con las claves pedidas; 2) base de la rama en la 89 (si hay Cargo.toml y taller.json `bd`);
// 3) .env remoto por stdin, 0600; 4) npm ci si cambió package-lock.json; 5) precompilar bajo cm-heavy.
// Sin envRemoto no se copia nada: el proceso usa solo el env del registro.
// Entorno que debe ver el proceso remoto: registro + DATABASE_URL si hay envRemoto y BD. Solo lectura; lanza si el nombre de BD no sale del Cargo.toml.

export async function construirFrontRemoto(config, id, entrada, rutas) {
  const pasos = entrada.build?.construirFront ?? [];
  if (!pasos.length) {
    return { ok: false, resumen: `modo build sin build.construirFront en la ficha de ${id}: no hay nada que construya el front` };
  }
  // [por que] Mutagen ignora `.env*`, así que un `frontend/.env.local` escrito por un `up` anterior
  // en dev sobrevive en la 89 y `vite build` lo leería igual: hornearía las credenciales de dev.
  // Con `build.autologinDev` eso es justo lo que se busca, así que no se borra (18AA-1).
  if (entrada.build?.autologinDev !== true) {
    await sshRemoto(config, `rm -f ${shQuote(`${rutas.dirRemoto}/frontend/.env.local`)}`);
  }
  for (const argv of pasos) {
    const r = await sshRemoto(config, comandoConstruirFront(rutas, id, argv), TIMEOUT_BUILD_MS);
    if (!r.ok) return { ok: false, resumen: `construirFront fallo, log ${rutas.dirLogs}/construir-front-${id}.log en ${config.host}: ${r.error}` };
  }
  const d = await sshRemoto(config, `test -f ${shQuote(`${rutas.dirRemoto}/${DIST_FRONT}/index.html`)}`);
  if (!d.ok) return { ok: false, resumen: `build.construirFront no dejo ${DIST_FRONT}/index.html en ${config.host}` };
  return { ok: true };
}


async function prepararRemoto(config, id, entrada, rama, rutas, modo = modoDe(entrada)) {
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
    // [por que] En build no se escribe el `.env` del front: es justo lo que hornearía las
    // credenciales de dev (`VITE_DEV_EMAIL`/`VITE_DEMO_PASSWORD`) en el bundle. El residuo de un
    // `up` anterior en dev lo borra `construirFrontRemoto`. La excepción la pide la ficha
    // (`build.autologinDev`, 18AA-1): ese bundle solo lo sirve el dev público de la 89 —el de
    // producción se construye por otra vía y no lleva ni las credenciales ni la bandera—, y sin
    // hornearlas la auto-entrada en modo build no tiene con qué entrar.
    const autologinDev = entrada.build?.autologinDev === true;
    if (modo !== 'build' || autologinDev) {
      const front = contenidoEnvFrontend(contenidoEnv, autologinDev);
      if (front !== null && existsSync(join(ruta, 'frontend'))) {
        const wf = await escribirArchivoRemoto(config, `${rutas.dirRemoto}/frontend/.env.local`, front);
        if (!wf.ok) return { ok: false, resumen: `frontend/.env.local remoto no se pudo escribir: ${wf.error}` };
      }
    }
  }
  for (const sub of entrada.dependencias ?? []) {
    const r = await sshRemoto(config, comandoNpmCi(rutas.dirRemoto, rutas.dirLogs, sub, id), TIMEOUT_BUILD_MS);
    if (!r.ok) return { ok: false, resumen: `npm ci (${sub}) fallo, log ${rutaLogNpmCi(rutas.dirLogs, sub, id)} en ${config.host}` };
  }
  for (const argv of entrada.precompilar ?? []) {
    const r = await sshRemoto(config, comandoPrecompilar(config, rutas, id, argv), TIMEOUT_BUILD_MS);
    // [por que] El 75 no siempre es el candado: cm-heavy tambien lo devuelve por RAM o disco, y
    // decir "otro build pesado" cuando falta RAM manda a esperar algo que no va a cambiar solo.
    if (r.codigo === 75) return { ok: false, resumen: `cm-heavy no arranca en ${config.host}: ${r.error || 'sin motivo'} (ver §12 de AGENTS.md)` };
    if (!r.ok) return { ok: false, resumen: `precompilar fallo, log ${rutas.dirLogs}/precompilar-${id}.log en ${config.host}: ${r.error}` };
  }
  // El front se construye después del binario y antes de arrancar: si falla, nunca se arranca con un
  // `dist` viejo.
  if (modo === 'build') {
    const cf = await construirFrontRemoto(config, id, entrada, rutas);
    if (!cf.ok) return cf;
  }
  return { ok: true, env, nombreBd };
}

// Puertos cuyo proceso vivo no tiene el entorno que pide el registro (otra rama, otro env). Solo lectura.
// [por que] Sin pid visible no hay forma de comprobarlo: ese puerto se reinicia en vez de darlo por bueno.

export async function upRemoto(config, id, entrada, args = []) {
  // `--dev`/`--build` sobrescriben el modo de la ficha solo para esta sesión.
  const modo = modoDe(entrada, args.includes('--dev') ? 'dev' : args.includes('--build') ? 'build' : undefined);
  const error = validarHostRemoto(entrada, config, modo);
  if (error) return { codigo: 1, resumen: `up ${id}: rehusado (${error})` };
  // A partir de aquí todo el arranque trabaja sobre el bloque del modo efectivo.
  // `ficha` guarda la entrada cruda: los puertos de los dos modos solo están ahí.
  const ficha = entrada;
  entrada = entradaEfectiva(entrada, modo);
  const rama = detectarRama(rutaAbsDe(entrada));
  const rutas = rutasRemotas(config, id, rama);
  // [por que] Antes del estado: si la sesión de sync se perdió, `up` la restaura aunque los procesos sigan vivos.
  const sync = asegurarSesion({ config, proyecto: id, rutaLocal: rutaAbsDe(entrada), rutas });
  if (sync !== 0) return { codigo: 1, resumen: `up ${id}: sincronizacion con ${config.host} no lista (mutagen, codigo ${sync}): NO verde` };
  // Las sesiones del otro modo no las ve `estadoRemoto` (mira los puertos del modo efectivo), así que
  // un proyecto que cambia de modo se quedaría con las dos arriba. Se paran aquí, antes de mirar el estado.
  const ajenos = puertosTodos(ficha).filter((p) => !puertosRemotosDe(entrada).includes(p));
  if (ajenos.length) {
    const r = await pararSesionesPuertos(config, id, ajenos);
    if (!r.ok) return { codigo: 1, resumen: `up ${id}: no paro las sesiones del otro modo (${ajenos.join(', ')}) en ${config.host}: ${r.error}: NO verde` };
  }
  // Y el túnel del modo que se deja: con reenvíos de más no pasa `tunelEsNuestro`, así que nadie lo
  // cierra y se queda ocupando un puerto local que el túnel nuevo necesita (`ExitOnForwardFailure`
  // haría fallar el `up`). Va antes del estado para no arrastrar el pid muerto en `previo`.
  if (usaTunel(entrada) && localesTodos(ficha).some((p) => !puertosLocalesDe(entrada).includes(p))) {
    for (const pid of await tunelesNuestrosEnPuertos(config, localesTodos(ficha), puertosTodos(ficha))) await matarTunel(pid);
  }
  const previo = await estadoRemoto(config, id, entrada);
  // [por que] Sin --sin-bd, un proyecto con base declarada (bdDesdeLocal) refresca su base al arrancar; si ya está arriba, solo con --bd.
  const forzarBd = args.includes('--bd');
  const sincronizar = config.proyectos?.[id]?.bdDesdeLocal !== undefined && !args.includes('--sin-bd') && (previo.estado !== 'bajo-mando' || forzarBd);
  let reiniciar = { puertos: [], detalle: [] };
  if (previo.estado === 'bajo-mando') {
    reiniciar = await puertosConEntornoDistinto(config, id, entrada, rama);
    if (!reiniciar.ok) return { codigo: 1, resumen: `up ${id}: ${reiniciar.motivo}: NO verde` };
    if (!reiniciar.puertos.length && !sincronizar) {
      // [por que] Sin esto un proyecto ya arriba nunca reconstruía el front: esta rama responde
      // antes de `prepararRemoto`, así que el `dist` se quedaba con el código de la vez anterior.
      // El backend sirve el directorio desde disco, así que basta con rehacerlo: no hay que reiniciar.
      if (modo === 'build') {
        const cf = await construirFrontRemoto(config, id, entrada, rutas);
        if (!cf.ok) return { codigo: 1, resumen: `up ${id}: ${cf.resumen}: NO verde` };
      }
      return { codigo: 0, resumen: `up ${id}: ya-arriba (${previo.motivo})${modo === 'build' ? ', front reconstruido' : ''}` };
    }
  }
  const prep = await prepararRemoto(config, id, entrada, rama, rutas, modo);
  if (!prep.ok) return { codigo: 1, resumen: `up ${id}: ${prep.resumen}: NO verde` };
  let bdResumen = null;
  if (sincronizar) {
    // [por que] La base solo se restaura con el backend parado: se paran todas las sesiones de este proyecto antes de tocarla.
    if (previo.estado !== 'parado') {
      const parado = await pararSesiones(config, id, ficha);
      if (!parado.ok) return { codigo: 1, resumen: `up ${id}: no paro sesiones antes de sincronizar la BD en ${config.host}: ${parado.error}: NO verde` };
      const libre = await esperarLibre(config, puertosRemotosDe(entrada), 15_000);
      if (!libre.ok) return { codigo: 1, resumen: `up ${id}: ${libre.motivo}: NO verde` };
    }
    const bd = await sincronizarBd(config, id, entrada, rutaAbsDe(entrada), prep.nombreBd, forzarBd);
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
    if (escucha.publico) await pararSesiones(config, id, ficha);
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
    const marcador = marcadorSonda(entrada, p);
    // [por que] Sin túnel el probe corre en la 89: es el loopback que expone cloudflared (o el propio servicio).
    const ok = usaTunel(entrada)
      ? await esperarSonda(puertosLocalesDe(entrada)[i], ruta, limiteMs, marcador)
      : await esperarSondaRemota(config, p, ruta, limiteMs, marcador);
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
  return { codigo: 0, resumen: `up ${id}: arrancado en ${config.host} (modo ${modo}, puertos ${remotos.join(', ')}, ${via}${reinicio})${bdResumen ? `; ${bdResumen}` : ''} + probe verde` };
}


export async function statusRemoto(config, id, entrada) {
  const r = await estadoRemoto(config, id, entrada);
  return { codigo: r.estado === 'bajo-mando' || r.estado === 'parado' ? 0 : 2, estado: r.estado, motivo: r.motivo };
}


export async function stopRemoto(config, id, entrada, ficha = entrada) {
  const estado = leerEstado(id);
  // [por que] Cerrar solo el PID registrado dejaba vivo el túnel real (ocupaba 3210/5299 y `up` fallaba después).
  const registrado = await tunelVivo(config, entrada, estado);
  // [por que] Sin la puerta de `usaTunel`: un proyecto que dejó de usar túnel (`tunelSsh: false`, como
  // MN al pasar a servirse por Cloudflare) conserva los ssh de cuando sí lo usaba, y nadie más los
  // cierra —el estado solo guarda el pid del modo efectivo—. Se quedaban ocupando puertos locales del
  // proyecto y habrían hecho fallar el `up --dev` siguiente (`ExitOnForwardFailure`).
  const enPuertos = await tunelesNuestrosEnPuertos(config, localesTodos(ficha), puertosTodos(ficha));
  const pids = [...new Set([registrado, ...enPuertos].filter(Boolean))];
  const remoto = await pararSesiones(config, id, ficha);
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


export async function logsRemoto(config, id, entrada, lineas) {
  const rutas = rutasRemotas(config, id, detectarRama(rutaAbsDe(entrada)));
  const partes = puertosRemotosDe(entrada).map((p) => `echo ${shQuote(`== ${p}`)}; tail -n ${lineas} ${shQuote(`${rutas.dirLogs}/dev-up-${id}-${p}.log`)} 2>&1`);
  const r = await sshRemoto(config, partes.join('; '));
  return r.ok ? { codigo: 0, salida: r.salida } : { codigo: 1, salida: `logs ${id}: ${r.error}` };
}

// Entrada del registro si es remota; null si no lo es o el registro no se puede leer (lo informa el camino local).
