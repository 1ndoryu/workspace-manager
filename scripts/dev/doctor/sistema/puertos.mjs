/* Puertos, modos (dev/build), tuneles, atribucion de dueño y deriva de entorno. */

import { cabeceraAutorizacion } from '../../token.mjs';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { isAbsolute, join, normalize, resolve } from 'node:path';

import { RAIZ_REPO } from '../base.mjs';
import { normalizarRuta } from './procesos.mjs';
import { PUERTO_API } from '../../../shared/puertos.mjs';

/* --- Modo del proyecto (16AA-18) y entrada remota ---------------------------
 * [por que] Viven aqui, en la base, y no en remoto.mjs: el doctor tambien los
 * necesita para clasificar una ficha con `host` (el tunel ssh ocupa su puerto
 * local), y definirlos dos veces los desincronizaria. remoto.mjs los reexporta. */

export function esEntradaRemota(entrada) {
  return typeof entrada?.host === 'string' && entrada.host !== '';
}

// `dev` = vite + backend, con HMR. `build` = front construido a `dist/` y servido por el backend
// Rust, como producción: se cae el vite, que son 150-650 MB de RAM por proyecto.
// [16AA-18 F8] El defecto es `build` (decidido por la usuaria el 2026-10-17): el taller es para
// probar lo que se despliega, y el vite se come la RAM que necesita `cm-heavy`.

export const MODO_POR_DEFECTO = 'build';

export const MODOS = new Set(['dev', 'build']);

// `override` = lo que pidan `up --dev` / `up --build` para esa sesión, sin tocar la ficha.
// [por que] El defecto solo alcanza a las fichas que tienen bloque `build`: una sin él no tiene
// nada a lo que cambiar (`entradaEfectiva` devolvería puertos vacíos), así que se queda en `dev`.
// Poner `modo: "build"` a mano sin bloque lo rechaza `validarHostRemoto` en claro.

export function modoDe(entrada, override) {
  if (override) return override;
  if (entrada.modo) return entrada.modo;
  return entrada.build ? MODO_POR_DEFECTO : 'dev';
}

// El bloque `build` declara sus propios puertos, botones, healths y locales porque no siempre es
// «un puerto menos»: la sesión de MN también aloja el conector de Cloudflare (20241).
// [por que] Todo el camino de arranque lee `puertosRemotos`/`botonRemoto`/`healths`/`puertosLocales`
// alineados por índice, así que devolver una copia con los del modo efectivo evita ramificar en
// cada función. En `dev` devuelve la entrada tal cual: cero cambios de comportamiento.

export function entradaEfectiva(entrada, modo = modoDe(entrada)) {
  if (modo !== 'build') return entrada;
  const b = entrada.build ?? {};
  return {
    ...entrada,
    puertos: b.puertos,
    puertosRemotos: b.puertos,
    puertosLocales: b.puertosLocales,
    botonRemoto: b.boton,
    healths: b.healths ?? [],
  };
}

// [por que] puertosRemotos (opcional): puertos que escucha la VPS cuando difieren de `puertos`.

export const puertosRemotosDe = (entrada) => entrada.puertosRemotos ?? entrada.puertos ?? [];

// [por que] puertosLocales (opcional, misma longitud que los remotos): el túnel abre ese puerto en
// el laptop y deja el remoto igual; sin él, el local es el remoto.

export const localesDeModo = (e) => puertosRemotosDe(e).map((p, i) => e.puertosLocales?.[i] ?? p);

/* URLs de un proyecto tal como las alcanza ESTE equipo. [por que] En un proyecto remoto el puerto
 * que escucha esta en la VPS y aqui solo responde el del tunel (`puertosLocales`): imprimir el
 * remoto da un enlace muerto (4190 en PROYECTO TASKS, medido el 2026-10-19). Sin `puertosLocales`
 * el local es el remoto, asi que la misma regla vale para los proyectos del portatil. */

export function urlsServidas(entrada) {
  const ef = entradaEfectiva(entrada);
  const healths = ef.healths?.length ? ef.healths : (ef.puertos ?? []).map((puerto) => ({ puerto }));
  const dominio = ef.dominio ?? '127.0.0.1';
  const remotos = puertosRemotosDe(ef);
  const locales = localesDeModo(ef);
  return healths.map((h) => {
    const i = remotos.indexOf(h.puerto);
    return `http://${dominio}:${i >= 0 ? locales[i] : h.puerto}${h.ruta ?? '/'}`;
  });
}


/* Pares (local, remoto) que la ficha declara para sus túneles, en los dos modos:
 * es exactamente lo que el portátil puede alcanzar de un proyecto remoto.
 * `tunelesExtra` añade reenvíos que no salen de los puertos: el puente del
 * gateway de MN (`-L 33110:127.0.0.1:3110`) lleva a un puerto ya declarado
 * (3110) desde uno que no lo está, y `puertosLocales` no puede decir las dos
 * cosas a la vez (3110 y 33110 apuntando al mismo remoto). */
export function paresTunel(entrada) {
  const deModo = (e) => puertosRemotosDe(e).map((r, i) => [localesDeModo(e)[i], r]);
  const pares = deModo(entrada);
  const b = entrada.build;
  if (b) pares.push(...deModo({ puertos: b.puertos, puertosLocales: b.puertosLocales }));
  for (const p of entrada.tunelesExtra ?? []) pares.push([p[0], p[1]]);
  return pares;
}


/* Reenvíos `-L` de un túnel ssh, como pares [local, remoto]. Puro.
 * [por que] El bind explícito es opcional: `-L 3110:127.0.0.1:3110` (lo que
 * escribe `ssh -f`) y `-L 127.0.0.1:3110:127.0.0.1:3110` son el mismo reenvío. */
export function reenviosTunel(cmd) {
  return [...String(cmd ?? '').matchAll(/-L\s+(?:127\.0\.0\.1:)?(\d+):(?:127\.0\.0\.1|localhost):(\d+)/g)].map(
    (m) => [Number(m[1]), Number(m[2])],
  );
}


/* ¿`proc` es el túnel ssh que la ficha `entrada` declara hacia su host? Todos
 * sus reenvíos tienen que ser pares declarados: un túnel de una versión
 * anterior, con reenvíos de más, no es el de esta ficha. */
export function tunelDeEntrada(proc, entrada) {
  if (!proc?.creado || !proc.cmd) return false;
  if (!/^ssh(\.exe)?$/i.test(proc.imagen ?? '')) return false;
  if (!esEntradaRemota(entrada) || !proc.cmd.includes(entrada.host)) return false;
  const reenvios = reenviosTunel(proc.cmd);
  if (!reenvios.length) return false;
  const pares = paresTunel(entrada);
  return reenvios.every(([l, r]) => pares.some(([pl, pr]) => pl === l && pr === r));
}


/* Entrada remota cuyo túnel es `proc`, o null. [por que] El túnel no es un
 * hueco del área: ocupa el puerto local del proyecto a propósito. */
export function tunelDeQuien(proc, entradas) {
  for (const e of entradas) if (tunelDeEntrada(proc, e)) return e;
  return null;
}

/* Entrada remota dueña del túnel que ocupa `puerto`, buscando entre los ssh
 * vivos, o null. [por que] netstat puede atribuir el listener a un pid ya
 * muerto (`ssh -f` se despide y deja al hijo escuchando): el proceso del
 * listener no existe, así que hay que buscar el túnel por su reenvío. */
export function tunelDeListener(puerto, sshVivos, entradas) {
  for (const proc of sshVivos) {
    if (!reenviosTunel(proc.cmd).some(([local]) => local === puerto)) continue;
    const e = tunelDeQuien(proc, entradas);
    if (e) return e;
  }
  return null;
}

/* Marcador de deteccion para un puerto: string unico o posicion i del
 * array (misma alineacion 1:1 que boton). Fuera de rango = primero (no hay
 * healths fuera de puertos: validarEntrada lo impide, esto es red). */
// [por que] Un health puede sondear un puerto solo remoto: el /ready del
// conector cloudflared (20241) vive en la 89 y no tiene oyente local.

export function puertoDeSaludValido(puerto, entrada) {
  const remotos = Array.isArray(entrada.puertosRemotos) ? entrada.puertosRemotos : [];
  const build = Array.isArray(entrada.build?.puertos) ? entrada.build.puertos : [];
  return entrada.puertos.includes(puerto) || remotos.includes(puerto) || build.includes(puerto);
}


/* Bloque `build` de una ficha remota (16AA-18): declara sus propios puertos, botones, locales,
 * healths y el comando que construye el front. En build el backend sirve `frontend/dist`, así que
 * `construirFront` es obligatorio: sin él el `dist` sería el de la vez anterior y el verde, fingido.
 * Devuelve el motivo del rechazo, o null. */
// [por que] distFront: carpeta del front compilado que ciclo.mjs comprueba tras construirFront.
const CLAVES_BUILD = ['puertos', 'boton', 'puertosLocales', 'healths', 'construirFront', 'autologinDev', 'distFront'];

export function validarBloqueBuild(e) {
  if (e.modo !== undefined && e.modo !== 'dev' && e.modo !== 'build') return `modo '${e.modo}' no valido (dev|build)`;
  if (e.build === undefined) return e.modo === 'build' ? 'modo build sin bloque build' : null;
  const b = e.build;
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return 'build debe ser un objeto';
  const puertos = b.puertos;
  if (!Array.isArray(puertos) || puertos.length === 0 || puertos.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535)) {
    return 'build.puertos: lista de puertos (1024-65535), no vacía';
  }
  if (!Array.isArray(b.boton) || b.boton.length !== puertos.length) return 'build.boton debe tener un comando por puerto';
  if (b.boton.some((x) => !Array.isArray(x) || x.length === 0 || x.some((s) => typeof s !== 'string'))) {
    return 'build.boton debe ser una lista de comandos (cada uno, una lista de textos)';
  }
  if (b.puertosLocales !== undefined) {
    const pl = b.puertosLocales;
    if (!Array.isArray(pl) || pl.length !== puertos.length || pl.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535)) {
      return 'build.puertosLocales debe tener un puerto local (1024-65535) por cada puerto de build';
    }
    if (new Set(pl).size !== pl.length) return 'build.puertosLocales repetidos';
  }
  for (const h of b.healths ?? []) {
    if (!Number.isInteger(h?.puerto) || !puertos.includes(h.puerto)) return 'build.healths: puerto fuera de build.puertos';
    if (typeof h.ruta !== 'string' || !h.ruta.startsWith('/')) return `build.healths sin ruta absoluta (puerto ${h.puerto})`;
    if ('esperaJson' in h && typeof h.esperaJson !== 'boolean') return `build.healths esperaJson no booleano (puerto ${h.puerto})`;
    if ('marcador' in h && (typeof h.marcador !== 'string' || h.marcador.length < 3 || h.marcador.length > 120)) {
      return `build.healths marcador debe ser texto de 3 a 120 (puerto ${h.puerto})`;
    }
    for (const k of Object.keys(h)) {
      if (!['puerto', 'ruta', 'esperaJson', 'marcador'].includes(k)) return `build.healths con clave desconocida '${k}'`;
    }
  }
  const pasos = b.construirFront;
  if (!Array.isArray(pasos) || pasos.length === 0 || pasos.some((p) => !Array.isArray(p) || p.length === 0 || p.some((s) => typeof s !== 'string'))) {
    return 'build.construirFront debe ser una lista de comandos (cada uno, una lista de textos)';
  }
  if (b.autologinDev !== undefined) {
    if (typeof b.autologinDev !== 'boolean') return 'build.autologinDev debe ser booleano';
    // [por que] Sin las credenciales en el `.env` remoto la bandera no enciende nada: el front
    // sale con `null` y el fallo se ve como un login normal, no como un error. Falla cerrado aquí.
    if (b.autologinDev) {
      const sinCredenciales = ['VITE_DEV_EMAIL', 'VITE_DEV_PASSWORD'].filter((k) => !(e.envRemoto ?? []).includes(k));
      if (sinCredenciales.length) return `build.autologinDev exige ${sinCredenciales.join(' y ')} en envRemoto`;
    }
  }
  for (const k of Object.keys(b)) {
    if (!CLAVES_BUILD.includes(k)) return `build con clave desconocida '${k}'`;
  }
  return null;
}


export function marcadorPuerto(entrada, puerto) {
  const m = entrada.expectedCmdline;
  if (!Array.isArray(m)) return m;
  const i = entrada.puertos.indexOf(puerto);
  return i >= 0 ? m[i] : m[0];
}


/* ¿El proceso pertenece al proyecto? Exe bajo la ruta del proyecto O
 * cmdline que contiene expectedCmdline (deteccion; el match EXACTO con
 * normalizacion UTC es pre-kill, F1). */
export function esDelProyecto(proc, rutaProyecto, expectedCmdline) {
  if (!proc) return false;
  const base = normalizarRuta(rutaProyecto);
  if (proc.exe && normalizarRuta(proc.exe).startsWith(base + '\\')) return true;
  // [por que] Antes solo se miraba el exe: un node lanzado desde la carpeta del
  // proyecto (ruta en cmd, exe fuera) salia ajeno (PROYECTO TASKS 4191 = falso
  // positivo). enRuta exige frontera: "area\glory" no casa con "area\glory-pulse".
  if (proc.cmd && enRuta(normalizarRuta(proc.cmd), base)) return true;
  if (proc.cmd && expectedCmdline && proc.cmd.includes(expectedCmdline)) return true;
  return false;
}


/* `base` (ya normalizada) aparece en `texto` (normalizado) seguida de fin,
 * separador, espacio o comilla: frontera de ruta, no prefijo de texto. */
export function enRuta(texto, base) {
  if (!base) return false;
  let i = texto.indexOf(base);
  while (i >= 0) {
    const siguiente = texto.charAt(i + base.length);
    if (siguiente === '' || siguiente === '\\' || siguiente === ' ' || siguiente === '"') return true;
    i = texto.indexOf(base, i + 1);
  }
  return false;
}


/* Dueño de un listener huerfano en `puerto`: el proyecto del pool que lo
 * reclama (ruta o marcador del puerto, igual que esDelProyecto), con la ruta
 * mas larga si hay varios. null = sin dueño conocido (grupo propio).
 * [por que] Solo por ruta, un proceso lanzado fuera de la carpeta (glory-backend
 * de PROYECTO TASKS en 4190) salia sin dueño: el marcador de su puerto lo reclama. */
export function atribuirHuerfano(proc, pool, puerto) {
  let clave = null;
  let mejor = -1;
  for (const p of pool) {
    const marcador = p.entrada ? marcadorPuerto(p.entrada, puerto) : undefined;
    const base = normalizarRuta(p.ruta).length;
    if (esDelProyecto(proc, p.ruta, marcador) && base > mejor) {
      mejor = base;
      clave = p.clave;
    }
  }
  return clave;
}


/* Listener auxiliar declarado en registro.auxiliares: puerto y marcador en la
 * linea de comando. Devuelve la clave del proyecto dueno o null. Entradas con
 * aviso de registro no cuentan: su configuracion no esta validada. */
export function auxiliarDe(puerto, cmd, entradas) {
  if (!cmd) return null;
  for (const e of entradas) {
    if (e._avisoRegistro) continue;
    for (const a of e.auxiliares ?? []) {
      if (a.puerto === puerto && cmd.includes(a.marcador)) return e.id;
    }
  }
  return null;
}


/* Dueño de un puerto ocupado: primero por proceso (la ruta del proyecto que
 * declara ese puerto), luego por auxiliar declarado. null = proceso ajeno.
 * [por que] El rehusado debe nombrar a quien tiene el puerto: sin nombre el
 * operador no sabe si es un tercero o un proyecto del propio registro. */
export function duenoDePuerto(puerto, pids, procs, entradas, raiz = RAIZ_REPO) {
  for (const pid of pids) {
    const proc = procs.get(pid);
    if (!proc) continue;
    for (const e of entradas) {
      if (typeof e.ruta !== 'string' || !(e.puertos ?? []).includes(puerto)) continue;
      const rutaAbs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(raiz, e.ruta);
      if (esDelProyecto(proc, rutaAbs, marcadorPuerto(e, puerto))) return { id: e.id, pid, via: 'proceso' };
    }
    const aux = auxiliarDe(puerto, proc.cmd, entradas);
    if (aux) return { id: aux, pid, via: 'auxiliar' };
  }
  return null;
}


/* Siguiente acción para un puerto que no se puede dar a `id`. Nunca mata: si
 * el dueño es otro proyecto, la salida es mover un puerto (registro + .env)
 * o parar ese proyecto a propósito, no un kill del mando. */
export function accionParaPuerto(id, puerto, pids, dueno, reclamados = []) {
  if (reclamados.length) {
    return `el registro declara el puerto ${puerto} para ${[id, ...reclamados].join(' y ')}: deja un solo dueño en config/registro.json`;
  }
  if (dueno && dueno.id !== id) {
    return `lo ocupa ${dueno.id} (pid ${dueno.pid}, ${dueno.via}); no se mata. Siguiente: mueve el puerto de ${id} en config/registro.json y su PORT en .env, o para ${dueno.id} si no lo necesitas ahora`;
  }
  return `lo ocupa un proceso ajeno (pid ${pids.join(',')}); no se mata. Siguiente: cierra ese proceso o mueve el puerto de ${id} en config/registro.json`;
}


/* Puertos que una entrada declara como suyos (puertos + auxiliares). */
function puertosDeclarados(e) {
  return [...(e.puertos ?? []), ...(e.auxiliares ?? []).map((a) => a?.puerto)].filter((p) => Number.isInteger(p));
}


const RE_PORT_ENV = /^[ \t]*PORT[ \t]*=[ \t]*(\d{2,5})[ \t]*(?:#.*)?$/gm;


/* Deriva entre `PORT=` de `.env`/`.env.example` y el registro. Solo aviso (no
 * cambia el exit): el backend Rust lee PORT, y si ese valor no es el declarado
 * (o lo reclama otro proyecto) el `up` del registro no lo ve hasta que falla.
 * Fail-open: un archivo ilegible se omite. */
export function detectarDerivaEnv(registro, { raiz = RAIZ_REPO } = {}) {
  const entradas = [...(registro.entradas?.values() ?? [])].filter((e) => typeof e.ruta === 'string');
  const reclamo = new Map(); // puerto -> ids que lo declaran
  for (const e of entradas) {
    for (const p of puertosDeclarados(e)) {
      if (!reclamo.has(p)) reclamo.set(p, []);
      reclamo.get(p).push(e.id);
    }
  }
  const avisos = [];
  for (const e of entradas) {
    const rutaAbs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(raiz, e.ruta);
    const propios = new Set(puertosDeclarados(e));
    for (const archivo of ['.env', '.env.example']) {
      let texto;
      try {
        texto = readFileSync(join(rutaAbs, archivo), 'utf8');
      } catch {
        continue;
      }
      for (const m of texto.matchAll(RE_PORT_ENV)) {
        const puerto = Number(m[1]);
        if (propios.has(puerto)) continue;
        const otros = (reclamo.get(puerto) ?? []).filter((x) => x !== e.id);
        const motivo = otros.length
          ? `PORT=${puerto} lo declara ${otros.join(', ')}`
          : `PORT=${puerto} no esta en puertos/auxiliares de ${e.id}`;
        avisos.push({ id: e.id, archivo, puerto, motivo });
      }
    }
  }
  return avisos;
}


/* Listener de tercero/sistema declarado en registro.ignoradosSistema. Por exe
 * (ruta exacta), por imagen (nombre .exe, para exe ocultos sin elevar), por
 * servicio de Windows (nombre, para exe protegidos) o por pid solo cuando no
 * hay exe (System = PID 4 en Windows). */
export function esSistemaIgnorado(pid, proc, lista = [], servicio = null, puerto = null) {
  return lista.some((s) => {
    if (s.servicio) return servicio?.nombre === s.servicio;
    if (s.imagen) return typeof proc?.imagen === 'string' && proc.imagen.toLowerCase() === s.imagen.toLowerCase();
    // [por que 16AA-20] Identidad por puerto solo para un proceso ilegible: si
    // tuviera exe, el ignorado no casa y el hueco sigue siendo visible.
    if (s.puerto) return s.puerto === puerto && !proc?.exe;
    if (!s.exe) return s.pid === pid && !proc?.exe;
    if (!proc?.exe || normalizarRuta(proc.exe) !== normalizarRuta(s.exe)) return false;
    return !s.cmdContiene || (proc.cmd ?? '').includes(s.cmdContiene);
  });
}


export function sondear(puerto, rutaRecurso, esperaJson, timeoutMs, dominio) {
  // [por que] Node/SO no resuelven *.localhost (solo el navegador aplica el
  // caso especial). El probe conecta a 127.0.0.1 con cabecera Host = dominio:
  // verifica que el servicio sirve ese nombre virtual. Sin dominio, como antes.
  // [por que 2] Vite por defecto escucha solo en ::1 (IPv6): si 127.0.0.1
  // rehusa la conexion se reintenta contra ::1 con la misma cabecera Host.
  // [por que 3] Host con puerto: la guardia del manager exige host:puerto, como un navegador.
  const cabeceras = dominio && dominio !== '127.0.0.1' ? { Host: `${dominio}:${puerto}` } : undefined;
  // [por que] El token solo va al manager: sondear sirve a todos los puertos y no debe filtrarlo a otros servicios.
  const conAuth = puerto === PUERTO_API ? cabeceraAutorizacion() : undefined;
  const intentar = (host) =>
    new Promise((resolveP) => {
      const req = http.get(
        { host, port: puerto, path: rutaRecurso || '/', timeout: timeoutMs, headers: { ...cabeceras, ...conAuth } },
        (res) => {
          let cuerpo = '';
          res.on('data', (t) => {
            cuerpo += t;
            if (cuerpo.length > 64 * 1024) req.destroy();
          });
          res.on('end', () => {
            const okStatus = res.statusCode === 200;
            let okJson = true;
            if (esperaJson !== false) {
              try {
                JSON.parse(cuerpo);
              } catch {
                okJson = false;
              }
            }
            resolveP({ ok: okStatus && okJson, status: res.statusCode });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => resolveP({ ok: false, status: null }));
    });
  return (async () => {
    const v4 = await intentar('127.0.0.1');
    if (v4.ok) return v4;
    if (v4.status === null) return intentar('::1');
    return v4;
  })();
}

