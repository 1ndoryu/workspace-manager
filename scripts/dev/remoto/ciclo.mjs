/* Ciclo de vida remoto: preparar, up, status, stop y logs. */

import { asegurarSesion, comandoBaseRemota, detectarRama, rutasRemotas, shQuote } from '../../remoto/rcargo.mjs';
import { entradaEfectiva, esPermanente, modoDe, paresTunelPortatil, puertosRemotosDe } from '../doctor.mjs';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { sincronizarBd } from './bd/sincronizar.mjs';
import { comandoConstruirFront, comandoNpmCi, comandoPrecompilar, comandoRemotoUp, rutaLogNpmCi, sesionTmux } from './comandos.mjs';
import { contenidoEnvFrontend, contenidoEnvRemoto, entornoRemoto, validarHostRemoto } from './entorno.mjs';
import { escribirEstado, escribirEstadoTunel, leerEstado, rutaEstado } from './estado.mjs';
import { ajenosEnPuertos, estadoRemoto, localesTodos, marcadorSonda, pararSesiones, pararSesionesPuertos, puertosConEntornoDistinto, puertosDeSalida, puertosTodos, resumenAjenos, rutaSonda } from './ficha.mjs';
import { rutaAbsDe } from './red/rutaLocal.mjs';
import { esperarEscucha, esperarLibre, esperarSonda, esperarSondaRemota } from './red/sondas.mjs';
import { escribirArchivoRemoto, sshRemoto } from './red/ssh.mjs';
import { abrirTunel, abrirTunelPares, matarTunel, puertosLocalesDe, tunelVivo, tunelesNuestrosEnPuertos, usaTunel } from './red/tunel.mjs';

const TIMEOUT_BUILD_MS = 900_000;

/* Sesiones VIVAS de esta entrada que NO estan bajo supervision. Se pregunta a tmux por el argv
 * real del bucle (`bucleSupervisado` deja el marcador `supervisar`), no al registro en disco.
 * [por que] `stop` borra el registro al parar, pero no puede mudar el proceso que corre: una
 * sesion arrancada antes de la bandera tiene argv sin bucle y registro sobrante, y una rearmada
 * despues tiene lo contrario. El argv es la unica verdad de lo que se va a rearmar.
 * `has-session` va primero porque sin sesion `list-panes` no devuelve nada y el `||` mentira. */
async function sesionesSinSupervisar(config, id, puertos) {
  const consulta = puertos
    .map((p) => {
      const s = shQuote(sesionTmux(id, p));
      return `if tmux has-session -t ${s} 2>/dev/null; then tmux list-panes -t ${s} -F '#{pane_start_command}' | grep -q supervisar || echo ${p}; fi`;
    })
    .join('; ');
  const r = await sshRemoto(config, consulta);
  if (!r.ok) return [];
  /* A numeros: llegan como texto del `echo` y con texto `indexOf` nunca encuentra su puerto
   * (`-1`), asi que se acabaria lanzando el boton de otro puerto en esa sesion. Solo los pedidos:
   * con todas supervisadas la salida es vacia y `Number('')` daba un puerto 0 (20AA-12). */
  return puertosDeSalida(r.salida, puertos);
}

// Dónde deja el front construido `npm run build` en los seis proyectos del taller. Es el directorio
// que sirve el backend en modo build, así que su `index.html` es la prueba de que el build cuajó.

// [por que] Por defecto `frontend/dist`; un proyecto con otra salida (p. ej. `client/dist`) la declara en build.distFront.
const DIST_FRONT_DEFECTO = 'frontend/dist';

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
  const distFront = entrada.build?.distFront ?? DIST_FRONT_DEFECTO;
  const d = await sshRemoto(config, `test -f ${shQuote(`${rutas.dirRemoto}/${distFront}/index.html`)}`);
  if (!d.ok) return { ok: false, resumen: `build.construirFront no dejo ${distFront}/index.html en ${config.host}` };
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
  // La bandera vive en la ficha cruda (no en el bloque del modo): ser permanente no depende de dev
  // o build. Se lee aquí porque la rama `bajo-mando` responde antes de llegar al arranque.
  const supervisar = esPermanente(ficha);
  const rama = detectarRama(rutaAbsDe(entrada));
  const rutas = rutasRemotas(config, id, rama);
  // [por que] Antes del estado: si la sesión de sync se perdió, `up` la restaura aunque los procesos sigan vivos.
  const sync = asegurarSesion({ config, proyecto: id, rutaLocal: rutaAbsDe(entrada), rutas });
  if (sync !== 0) return { codigo: 1, resumen: `up ${id}: sincronizacion con ${config.host} no lista (mutagen, codigo ${sync}): NO verde` };
  // [por que] Un puerto ocupado por otro proceso no es un `ya-arriba` ni un arranque: el nuestro chocaría
  // con él y el probe daría verde con su respuesta. Va antes de parar nada: no se toca ningún proceso (12AA-7).
  const duenosPrevios = await ajenosEnPuertos(config, id, puertosRemotosDe(entrada));
  if (!duenosPrevios.ok) return { codigo: 1, resumen: `up ${id}: no compruebo el dueño de los puertos en ${config.host} (${duenosPrevios.error}): NO verde` };
  if (duenosPrevios.ajenos.length) return { codigo: 1, resumen: `up ${id}: ${resumenAjenos(duenosPrevios.ajenos)}: NO verde` };
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
    /* Encender la bandera con el proyecto ya arriba: la sesion se creo SIN bucle y
     * `taller-vigilante.sh` solo repite lo que quedo en el registro de supervision. Sin esta
     * pasada, la bandera encendida desde el tablero no prometeria nada hasta el siguiente reinicio.
     * Se rearma aqui y no mas abajo porque el camino de arranque completo reconstruye el front
     * (minutos) para escribir un booleano. Se pregunta a tmux por el argv real, no a un archivo. */
    if (!reiniciar.puertos.length && !sincronizar && supervisar) {
      const sinBucle = await sesionesSinSupervisar(config, id, puertosRemotosDe(entrada));
      if (sinBucle.length) {
        let env;
        try {
          env = entornoRemoto(config, id, entrada, rama).env;
        } catch (e) {
          return { codigo: 1, resumen: `up ${id}: ${e.message}: NO verde` };
        }
        const parado = await pararSesionesPuertos(config, id, sinBucle);
        if (!parado.ok) return { codigo: 1, resumen: `up ${id}: no paro sesiones sin bucle (${sinBucle.join(', ')}) en ${config.host}: ${parado.error}: NO verde` };
        const libre = await esperarLibre(config, sinBucle, 15_000);
        if (!libre.ok) return { codigo: 1, resumen: `up ${id}: ${libre.motivo}: NO verde` };
        const remotos = puertosRemotosDe(entrada);
        const botones = entrada.botonRemoto ?? entrada.boton;
        for (const p of sinBucle) {
          // Sin boton propio para ese puerto no se inventa uno: se sigue con el arranque normal.
          const boton = botones[remotos.indexOf(p)] ?? botones[0];
          if (!boton) return { codigo: 1, resumen: `up ${id}: la ficha no declara boton para el puerto ${p}: NO verde` };
          const r = await sshRemoto(config, comandoRemotoUp(config, rutas, id, p, boton, env, true));
          if (!r.ok) return { codigo: 1, resumen: `up ${id}: no rearme con bucle el puerto ${p}: ${r.error}` };
        }
        const escucha2 = await esperarEscucha(config, entrada, entrada.arranqueMs ?? 60_000);
        if (!escucha2.ok) return { codigo: 1, resumen: `up ${id}: ${escucha2.motivo} tras armar el bucle: NO verde` };
        return { codigo: 0, resumen: `up ${id}: ya-arriba (${previo.motivo}), rearmado con bucle permanente` };
      }
    }
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
    const r = await sshRemoto(config, comandoRemotoUp(config, rutas, id, p, (entrada.botonRemoto ?? entrada.boton)[i], prep.env, supervisar));
    if (!r.ok) return { codigo: 1, resumen: `up ${id}: arranque remoto fallo (puerto ${p}): ${r.error}` };
  }
  const limiteMs = entrada.arranqueMs ?? 60_000;
  const escucha = await esperarEscucha(config, entrada, limiteMs);
  if (!escucha.ok) {
    if (escucha.publico) await pararSesiones(config, id, ficha);
    return { codigo: 1, resumen: `up ${id}: ${escucha.motivo}: NO verde` };
  }
  // [por que] Otro proceso puede haber ganado el puerto mientras arrancábamos: nuestra sesión falla y el
  // probe daría verde con su respuesta. Se para solo nuestra sesión de ese puerto; el proceso ajeno no se toca.
  const duenosTras = await ajenosEnPuertos(config, id, remotos);
  if (!duenosTras.ok) return { codigo: 1, resumen: `up ${id}: no compruebo el dueño de los puertos tras arrancar (${duenosTras.error}): NO verde` };
  if (duenosTras.ajenos.length) {
    await pararSesionesPuertos(config, id, duenosTras.ajenos.map((a) => a.puerto));
    return { codigo: 1, resumen: `up ${id}: ${resumenAjenos(duenosTras.ajenos)}: NO verde` };
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


/* Reabre SOLO el tramo del portátil: los ssh que esta entrada necesita (`paresTunelPortatil`,
 * que suma `tunelesExtra` y `tunelesLab`). No toca la 89, no toca la BD y no reconstruye el front.
 * [por que] Un `up` completo tarda minutos (reconstruye el front en build) y el supervisor del
 * tablero lo llamaría cada vez que se cae la red: reparar un túnel tiene que costar segundos.
 * [por que] Un solo ssh con todos los reenvíos, como los demás del taller: `ExitOnForwardFailure`
 * falla entero si un puerto local está ocupado, y así no queda un túnel a medias que parezca vivo.
 * El PID se guarda en DOS sitios: el estado del `up` (lo que valida `stop`) y un registro propio
 * con los pares de la lab (lo que vigila el supervisor, que también mira 33110). */
export async function upRemotoTunel(config, id, entrada) {
  const pares = paresTunelPortatil(entrada);
  if (!pares.length) return { codigo: 1, resumen: `up ${id} --solo-tunel: la ficha no declara ningun reenvio para el portatil` };
  const locales = pares.map(([l]) => l);
  const remotos = pares.map(([, r]) => r);
  // Primero se matan los túneles nuestros que ocupan esos puertos: con ExitOnForwardFailure un
  // puerto tomado hace fallar el nuevo (pasó con MN al cambiar de modo).
  for (const pid of await tunelesNuestrosEnPuertos(config, locales, remotos)) await matarTunel(pid);
  const t = await abrirTunelPares(config, pares, id);
  if (!t.pid) return { codigo: 1, resumen: `up ${id} --solo-tunel: el tunel no levanto (log ${t.rutaLog})` };
  escribirEstadoTunel(id, { pid: t.pid, creado: t.creado, pares, en: new Date().toISOString() });
  return { codigo: 0, resumen: `up ${id} --solo-tunel: tunel reabierto (pid ${t.pid}, ${pares.map(([l, r]) => `${l}->${r}`).join(', ')})` };
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
