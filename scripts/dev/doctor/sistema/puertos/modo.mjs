/* Modo dev/build de una ficha remota, entrada efectiva, URLs y túneles ssh. Puro: sin IO.
 * Reexportado desde ../puertos.mjs, así que los importadores no cambian.
 * [por que] Partido de puertos.mjs para bajar del límite de 300 líneas (gate limite-lineas). */

/* --- Modo del proyecto (16AA-18) y entrada remota ---------------------------
 * [por que] Viven aqui, en la base, y no en remoto.mjs: el doctor tambien los
 * necesita para clasificar una ficha con `host` (el tunel ssh ocupa su puerto
 * local), y definirlos dos veces los desincronizaria. remoto.mjs los reexporta. */

// [por que] Con espacios sobrantes (" dev89 ") no es un alias válido: el mismo criterio que config.ts.
export function esEntradaRemota(entrada) {
  return typeof entrada?.host === 'string' && entrada.host.trim() !== '';
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

