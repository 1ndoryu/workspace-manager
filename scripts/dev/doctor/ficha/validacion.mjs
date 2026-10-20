/* Validacion de una entrada del registro (schema v1): falla cerrado. */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';

import { rutaConfigPrivada } from '../../../shared/rutas.mjs';

import { validarConsumeArtefacto } from './consume-artefacto.mjs';

import { EXES_PERMITIDOS, MOTIVOS_ENUM, PUERTOS_PROTEGIDOS, RAIZ_REPO, RE_OTRO, SCRIPTS_NODO_VALIDOS } from '../base.mjs';
import { entradaEfectiva, puertoDeSaludValido, validarBloqueBuild } from '../sistema/puertos.mjs';

/* Alias SSH del taller, tal y como lo declara `config/taller.json`, o null.
 * [por que] El alias de la máquina no puede vivir en el código: en otro entorno no
 * existe y una ficha ya escrita con él dejaría de entenderse. Se lee una vez y se
 * memoriza (esto valida una entrada por proyecto). Sin taller, la forma válida del
 * modo es solo el papel. */
let aliasTallerCache;
function hostDelTaller() {
  if (aliasTallerCache === undefined) {
    aliasTallerCache = null;
    try {
      const t = JSON.parse(readFileSync(rutaConfigPrivada('taller.json'), 'utf8'));
      if (typeof t?.host === 'string' && t.host.trim()) aliasTallerCache = t.host.trim();
    } catch {
      /* sin taller declarado no hay alias que aceptar */
    }
  }
  return aliasTallerCache;
}

export function validarEntrada(e) {
  // [por que 06AA-1] Un desvio en UNA entrada jamas bloquea el mando global:
  // se anota en `e._avisoRegistro` (la entrada queda no-actuable: ni `up` ni
  // `status` la tocan, sale como deriva con ese motivo) y el resto sigue.
  // Solo lo estructural sin id atribuible (no-objeto, sin id, id duplicado)
  // sigue siendo error global: sin id no hay a quien anotar.
  if (typeof e !== 'object' || e === null) throw new Error('registro: entrada no objeto');
  for (const k of ['id', 'ruta', 'boton', 'puertos', 'expectedCmdline']) {
    if (!(k in e)) {
      if (typeof e.id === 'string' && e.id.length > 0) {
        if (!e._avisoRegistro) e._avisoRegistro = `registro: '${e.id}' entrada sin '${k}'`;
        return;
      }
      throw new Error(`registro: entrada sin '${k}' (${JSON.stringify(e).slice(0, 80)})`);
    }
  }
  const mal = (motivo) => {
    if (!e._avisoRegistro) e._avisoRegistro = motivo;
  };
  // [por que] `procesosAceptados` lo lee cierre.mjs (excepción de procesos propios, b4ac545); sin él el doctor marcaba deriva.
  const conocidas = new Set(['id', 'ruta', 'boton', 'puertos', 'procesosAceptados', 'healths', 'timeoutMs', 'arranqueMs', 'expectedCmdline', 'tipoLauncher', 'dominio', 'requiere', 'env', 'reconstruir', 'auxiliares', 'comandos', 'host', 'analisisEn', 'envRemoto', 'botonRemoto', 'puertosRemotos', 'puertosLocales', 'tunelSsh', 'tunelesExtra', 'hostsPublicos', 'puertosPublicos', 'buildMode', 'precompilar', 'dependencias', 'modo', 'build', 'envTareas', 'tokenPulse', 'higieneRust', 'despliegue', 'consumeArtefacto']);
  for (const k of Object.keys(e)) {
    if (!conocidas.has(k)) {
      mal(`registro: clave desconocida '${k}' en '${e.id}'`);
      return;
    }
  }
  // [por que] envTareas, tokenPulse e higieneRust son banderas del proyecto:
  // antes se deducian comparando `id` con un nombre concreto (env de tareas de
  // workspace-manager, token estable de glory-pulse, higiene Rust de PROYECTO
  // TASKS); ahora las declara el registro.
  for (const k of ['envTareas', 'tokenPulse', 'higieneRust']) {
    if (k in e && typeof e[k] !== 'boolean') {
      mal(`registro: '${e.id}' ${k} debe ser booleano`);
      return;
    }
  }
  // [por que] `host` = la entrada corre en esa VPS (scripts/dev/remoto.mjs). Solo el nombre; que coincida con taller.json lo exige remoto.mjs (fail-closed).
  if ('host' in e && (typeof e.host !== 'string' || e.host === '')) {
    mal(`registro: '${e.id}' host debe ser un alias no vacio`);
    return;
  }
  const rutaAbs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(RAIZ_REPO, e.ruta);
  // [por que] El mando gestiona proyectos hermanos: el area valida es la
  // carpeta que contiene a este repo, no este repo solo.
  const areaNorm = normalize(resolve(RAIZ_REPO, '..'));
  if (rutaAbs !== areaNorm && !rutaAbs.startsWith(areaNorm + sep)) {
    mal(`registro: '${e.id}' ruta fuera del area (${e.ruta})`);
    return;
  }
  if (!existsSync(rutaAbs)) {
    mal(`registro: '${e.id}' ruta inexistente (${e.ruta})`);
    return;
  }
  // [por que 06AA-1] `reconstruir` = auto-reparacion declarada: si el exe del
  // boton falta (p. ej. el sweep purgo el target por rama), `up` recompila
  // solo con `cargo build --manifest-path` + CARGO_TARGET_DIR declarado, en
  // vez de rehusar todo el mando. Manifest siempre bajo la ruta de la
  // entrada (nunca fuera del area); targetDir absoluta (vive en C:\tmp por
  // regla del area, nunca en el arbol). Sin `reconstruir`, el exe ausente
  // sigue siendo aviso no-actuable (fail-closed por entrada).
  if ('reconstruir' in e) {
    const r = e.reconstruir;
    if (typeof r !== 'object' || r === null || Array.isArray(r)) {
      mal(`registro: '${e.id}' reconstruir no es objeto`);
      return;
    }
    for (const k of Object.keys(r)) {
      if (!['manifest', 'targetDir'].includes(k)) {
        mal(`registro: '${e.id}' reconstruir con clave desconocida '${k}'`);
        return;
      }
    }
    if (typeof r.manifest !== 'string' || r.manifest.length === 0) {
      mal(`registro: '${e.id}' reconstruir sin manifest`);
      return;
    }
    const manAbs = resolve(rutaAbs, r.manifest);
    if (manAbs !== rutaAbs && !manAbs.startsWith(rutaAbs + sep)) {
      mal(`registro: '${e.id}' reconstruir manifest fuera de la ruta (${r.manifest})`);
      return;
    }
    if (!existsSync(manAbs)) {
      mal(`registro: '${e.id}' reconstruir manifest inexistente (${r.manifest})`);
      return;
    }
    if (typeof r.targetDir !== 'string' || !isAbsolute(r.targetDir)) {
      mal(`registro: '${e.id}' reconstruir targetDir debe ser absoluta`);
      return;
    }
    e._manifestAbs = manAbs;
    e._targetDirAbs = normalize(r.targetDir);
  }
  // [por que] El binario absoluto no necesita args (longitud 1 vale); el resto
  // exige exe + args para que el `up` sepa que lanzar sin suposiciones.
  // [por que] Un proyecto «sin servicio de red» (p. ej. app de escritorio que
  // no arranca con `up`) no tiene botón: boton vacío es su forma correcta.
  const sinServicio = /^sin servicio de red/.test(e.tipoLauncher ?? '');
  if (!Array.isArray(e.boton) || (e.boton.length === 0 && !sinServicio) || e.boton.some((a) => !Array.isArray(a) || a.some((t) => typeof t !== 'string' || t.length === 0) || (a.length < 2 && !(/^[a-z]:[\\/]/i.test(a[0]) && a[0].toLowerCase().endsWith('.exe'))))) {
    mal(`registro: '${e.id}' boton debe ser array de argv (arrays de >=2 strings)`);
    return;
  }
  if (!Array.isArray(e.puertos) || e.puertos.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
    mal(`registro: '${e.id}' puertos invalidos`);
    return;
  }
  // [por que] `env` fija puertos/URLs por proyecto sin tocar sus repos
  // (PORT/VITE_API_URL/VITE_PORT): el mando compone el entorno, cada repo
  // conserva sus defaults. Solo strings no vacios; nada de objetos.
  if ('env' in e) {
    if (typeof e.env !== 'object' || e.env === null || Array.isArray(e.env)) {
      mal(`registro: '${e.id}' env no es objeto`);
      return;
    }
    for (const [k, v] of Object.entries(e.env)) {
      if (typeof v !== 'string' || v.length === 0) {
        mal(`registro: '${e.id}' env['${k}'] debe ser string no vacio`);
        return;
      }
    }
  }
  // [por que] Campos del taller (14AA-5): los lee la conformidad (src/shared/taller/conformidad.ts),
  // el mando solo los valida para no marcar deriva a una entrada bien declarada.
  if ('hostsPublicos' in e && (!Array.isArray(e.hostsPublicos) || e.hostsPublicos.some((h) => typeof h !== 'string' || h === ''))) {
    mal(`registro: '${e.id}' hostsPublicos debe ser array de hostnames`);
    return;
  }
  if ('puertosPublicos' in e && (!Array.isArray(e.puertosPublicos) || e.puertosPublicos.some((p) => !Number.isInteger(p) || p < 1 || p > 65535))) {
    mal(`registro: '${e.id}' puertosPublicos invalidos`);
    return;
  }
  // [por que] tunelSsh: lo lee remoto.mjs (false = la VPS expone sus puertos sola; sin túnel no hay puertosLocales).
  if ('tunelSsh' in e && typeof e.tunelSsh !== 'boolean') {
    mal(`registro: '${e.id}' tunelSsh debe ser true o false`);
    return;
  }
  // [por que] tunelesExtra: reenvíos declarados que no salen de `puertos` ni del
  // bloque `build` (el puente del gateway de MN: 33110 -> 3110 de la 89). Sin
  // esto el túnel del proyecto salía huérfano «(sin proyecto)».
  if ('tunelesExtra' in e) {
    if (!Array.isArray(e.tunelesExtra) || e.tunelesExtra.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isInteger(n) || n < 1024 || n > 65535))) {
      mal(`registro: '${e.id}' tunelesExtra debe ser array de pares [local, remoto] (1024-65535)`);
      return;
    }
  }
  // [por que S3.7] analisisEn: dónde corre el análisis Sentinel/VarSense del gate. Ausente =
  // lo que diga el taller. El alias del host se sigue aceptando: era el valor con el que se
  // escribía antes de que el modo se llamara por su papel.
  const aliasTaller = hostDelTaller();
  const modosValidos = aliasTaller ? ['local', 'taller', aliasTaller] : ['local', 'taller'];
  if ('analisisEn' in e && !modosValidos.includes(e.analisisEn)) {
    mal(`registro: '${e.id}' analisisEn debe ser 'local', 'taller' o el host del taller${aliasTaller ? ` ('${aliasTaller}')` : ' (ninguno declarado)'}`);
    return;
  }
  if ('buildMode' in e && (typeof e.buildMode !== 'string' || e.buildMode === '')) {
    mal(`registro: '${e.id}' buildMode debe ser string no vacio`);
    return;
  }
  // [por que] argv[i] <-> puertos[i]: sin igualdad posicional el `up` no sabe
  // que lanzar ante un puerto caido y cualquier suposicion seria verde fingido.
  if (e.boton.length !== e.puertos.length) {
    mal(`registro: '${e.id}' boton (${e.boton.length}) y puertos (${e.puertos.length}) deben alinearse 1:1`);
    return;
  }
  for (const argv of e.boton) {
    const exe = argv[0].toLowerCase();
    // [por que] Binario absoluto precompilado (p. ej. pulse.exe): evita
    // `cargo run`, cuyo hijo hereda una consola visible permanente. Solo ruta
    // absoluta existente: el registro versionado ya es la lista de confianza,
    // igual que los scripts node de la allowlist.
    const esBinarioAbsoluto =
      /^[a-z]:[\\/]/i.test(argv[0]) && exe.endsWith('.exe') && existsSync(resolve(argv[0]));
    // [por que 06AA-1] Exe con forma valida pero ausente + `reconstruir`
    // declarado = aviso accionable (el motivo dice el remedio: `up`), no
    // un "fuera de allowlist" que esconderia la causa real. Sin
    // `reconstruir`, el ausente es aviso no-actuable igualmente (fail-closed
    // por entrada, nunca bloqueo global).
    const esExeAbsoluto = /^[a-z]:[\\/]/i.test(argv[0]) && exe.endsWith('.exe');
    if (esExeAbsoluto && !existsSync(resolve(argv[0]))) {
      if (e._manifestAbs) {
        mal(`registro: '${e.id}' exe ausente, reconstruible con up (${argv[0]})`);
        e._exeAusente = argv[0];
      } else {
        mal(`registro: '${e.id}' exe inexistente (${argv[0]})`);
      }
      return;
    }
    if (!EXES_PERMITIDOS.has(exe) && !(exe.endsWith('/node') || exe.endsWith('\\node')) && !esBinarioAbsoluto) {
      mal(`registro: '${e.id}' exe fuera de allowlist (${argv[0]})`);
      return;
    }
    if ((exe === 'node' || exe.endsWith('/node') || exe.endsWith('\\node')) && argv[1] !== '-e') {
      const nombre = argv[1].split('/').pop().split('\\').pop();
      /* Servidor compilado del propio manager: un solo proceso node (sin tsx/cli
       * hijo que pida consola). Ruta fijada exacta, no basename generico. */
      const esServidorCompilado = argv[1].replace(/\\/g, '/') === 'dist-server/server/index.js';
      if (!esServidorCompilado && !SCRIPTS_NODO_VALIDOS.has(nombre)) {
        mal(`registro: '${e.id}' script node fuera de allowlist (${argv[1]})`);
        return;
      }
      const rutaScript = resolve(rutaAbs, argv[1]);
      if (!existsSync(rutaScript)) {
        mal(`registro: '${e.id}' script inexistente (${argv[1]})`);
        return;
      }
    }
  }
  for (const p of e.puertos) {
    // [por que] 8787/5175 son del propio manager y 5174 de opencode-propio:
    // ningun OTRO proyecto puede reclamarlos; la entrada raiz si (self).
    if (PUERTOS_PROTEGIDOS.has(p) && rutaAbs !== normalize(RAIZ_REPO)) {
      mal(`registro: '${e.id}' usa puerto protegido ${p}`);
      return;
    }
  }
  const healths = e.healths ?? [];
  if (!Array.isArray(healths)) {
    mal(`registro: '${e.id}' healths no es array`);
    return;
  }
  for (const h of healths) {
    if (!Number.isInteger(h?.puerto) || !puertoDeSaludValido(h.puerto, e)) {
      mal(`registro: '${e.id}' health con puerto fuera de la entrada`);
      return;
    }
    // [por que] Health sin ruta valida = probe contra el(Query) puerto sin
    // saber que pedir: el verde seria fingido. Sin validacion, un typo
    // (`ruta: 'api/x'` sin barra) pasa callado y el probe falla como deriva.
    if (typeof h.ruta !== 'string' || !h.ruta.startsWith('/')) {
      mal(`registro: '${e.id}' health sin ruta absoluta (puerto ${h.puerto})`);
      return;
    }
    if ('esperaJson' in h && typeof h.esperaJson !== 'boolean') {
      mal(`registro: '${e.id}' health esperaJson no booleano (puerto ${h.puerto})`);
      return;
    }
    // [por que] En modo build el `/` lo sirve el backend Rust, así que un 200 puede ser la API y no
    // la SPA: el marcador es lo que distingue una de otra. Corto = se cumpliría por casualidad.
    if ('marcador' in h && (typeof h.marcador !== 'string' || h.marcador.length < 3 || h.marcador.length > 120)) {
      mal(`registro: '${e.id}' health marcador debe ser texto de 3 a 120 (puerto ${h.puerto})`);
      return;
    }
    for (const k of Object.keys(h)) {
      if (!['puerto', 'ruta', 'esperaJson', 'marcador'].includes(k)) {
        mal(`registro: '${e.id}' health con clave desconocida '${k}'`);
        return;
      }
    }
  }
  const malBuild = validarBloqueBuild(e);
  if (malBuild) {
    mal(`registro: '${e.id}' ${malBuild}`);
    return;
  }
  // [por que] Dominio .localhost = URL con nombre por proyecto sin tocar
  // hosts ni pedir administrador (el navegador lo resuelve a loopback).
  // Formato cerrado: solo <slug>.localhost; nada publico, nada configurable.
  // [por que] `dominio: null` es válido en un proyecto sin servicio de red.
  if ('dominio' in e && e.dominio !== null && (typeof e.dominio !== 'string' || !/^[a-z0-9-]{1,40}\.localhost$/.test(e.dominio))) {
    mal(`registro: '${e.id}' dominio debe ser <slug>.localhost`);
    return;
  }
  // [por que] `requiere` = dependencias de arranque (p. ej.
  // workspace-manager necesita pulse: sin el, el panel VPS se queda en
  // "conectando con pulse..." para siempre). Forma: array de ids del
  // registro, sin autorreferencia; la existencia se valida en leerRegistro
  // (aqui aun no se conocen todos los ids) y los ciclos en `up`.
  if ('requiere' in e) {
    if (!Array.isArray(e.requiere) || e.requiere.some((d) => typeof d !== 'string' || d.length === 0)) {
      mal(`registro: '${e.id}' requiere debe ser array de ids (strings no vacios)`);
      return;
    }
    if (e.requiere.includes(e.id)) {
      mal(`registro: '${e.id}' se requiere a si mismo`);
      return;
    }
  }
  // [por que] F0d: nuevo launcher = campo tipoLauncher + checklist, no `if`
  // en codigo. Si viene, debe decir algo (string no vacio); el contenido lo
  // documenta el onboarding, el doctor solo exige que exista con forma.
  if ('tipoLauncher' in e && (typeof e.tipoLauncher !== 'string' || e.tipoLauncher.length === 0)) {
    mal(`registro: '${e.id}' tipoLauncher vacio`);
    return;
  }
  if ('timeoutMs' in e && (!Number.isInteger(e.timeoutMs) || e.timeoutMs < 500 || e.timeoutMs > 30000)) {
    mal(`registro: '${e.id}' timeoutMs fuera de 500..30000`);
    return;
  }
  // [por que] timeoutMs = probe puntual; arranqueMs = compilacion fria
  // (cargo). Confundirlos deja un arranque real fuera de tiempo o un probe
  // colgado minutos. Tope 5 min: mas alla es pipeline, no `up`.
  if ('arranqueMs' in e && (!Number.isInteger(e.arranqueMs) || e.arranqueMs < 5000 || e.arranqueMs > 300000)) {
    mal(`registro: '${e.id}' arranqueMs fuera de 5000..300000`);
    return;
  }
  // [por que] auxiliares: listeners del proyecto que NO son de su mando (p. ej.
  // un script lanzado a mano). Fuera de `puertos`: si estan abajo no hay
  // deriva; si estan arriba con el marcador en su cmd, son del proyecto.
  if ('auxiliares' in e) {
    if (!Array.isArray(e.auxiliares)) {
      mal(`registro: '${e.id}' auxiliares no es array`);
      return;
    }
    // [por que 16AA-20] Que un puerto sea del mando depende del modo: en `build`
    // el mando sirve los del bloque y el resto no son suyos. MN declara su
    // gateway (3102) en `puertos` —lo arranca en dev— pero en build vive en el
    // portatil y lo mantiene el guardian, asi que ahi si es un auxiliar legitimo.
    // Se compara contra los puertos efectivos, no contra los de la ficha.
    const gestionados = new Set(entradaEfectiva(e).puertos ?? []);
    for (const a of e.auxiliares) {
      const enPuertos = gestionados.has(a?.puerto);
      const valido =
        typeof a === 'object' && a !== null &&
        Number.isInteger(a.puerto) && a.puerto >= 1 && a.puerto <= 65535 && !enPuertos &&
        typeof a.marcador === 'string' && a.marcador.length >= 3 && a.marcador.length <= 120 &&
        typeof a.motivo === 'string' && a.motivo.length >= 3 && a.motivo.length <= 120;
      if (!valido) {
        mal(`registro: '${e.id}' auxiliares: cada entrada exige puerto (fuera de puertos), marcador (3-120) y motivo (3-120)`);
        return;
      }
    }
  }
  // [por que 20AA-7] `consumeArtefacto` = esta entrada empotra el artefacto de
  // compilacion de OTRO proyecto (MN-Escritorio <- MN-Inmobiliaria/frontend/dist).
  // El sub-esquema vive en su modulo: aqui el archivo esta en el limite de 300
  // lineas efectivas del gate.
  if ('consumeArtefacto' in e && !validarConsumeArtefacto(e, mal)) return;
  if (typeof e.expectedCmdline !== 'string' && !Array.isArray(e.expectedCmdline)) {
    mal(`registro: '${e.id}' expectedCmdline vacio`);
    return;
  }
  // [por que] Servicios con hijos heterogeneos (backend Rust compilado en
  // C:\tmp + frontend Vite bajo la ruta) no comparten ningun substring en
  // sus cmdlines: un marcador unico deja un puerto en deriva en el camino
  // feliz. Array alinea con puertos (igual que boton): string sigue valiendo
  // cuando un marcador cubre todos (compat v1).
  if (Array.isArray(e.expectedCmdline)) {
    if (e.expectedCmdline.length !== e.puertos.length) {
      mal(`registro: '${e.id}' expectedCmdline (${e.expectedCmdline.length}) y puertos (${e.puertos.length}) deben alinearse 1:1`);
      return;
    }
    for (const m of e.expectedCmdline) {
      if (typeof m !== 'string' || m.length === 0) {
        mal(`registro: '${e.id}' expectedCmdline con marcador vacio`);
        return;
      }
    }
  } else if (e.expectedCmdline.length === 0) {
    mal(`registro: '${e.id}' expectedCmdline vacio`);
    return;
  }
}


export function validarMotivo(motivo, donde) {
  if (MOTIVOS_ENUM.has(motivo)) return;
  const m = RE_OTRO.exec(motivo ?? '');
  if (!m) throw new Error(`${donde}: motivo fuera de enum (${motivo})`);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const cad = new Date(m[2] + 'T00:00:00');
  if (Number.isNaN(cad.getTime())) throw new Error(`${donde}: caducidad invalida (${m[2]})`);
  const dias = Math.round((cad - hoy) / 86_400_000);
  if (dias < 1 || dias > 31) throw new Error(`${donde}: caducidad fuera de 1..31 dias (${m[2]})`);
}

