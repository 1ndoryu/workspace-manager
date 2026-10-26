/* Reglas PURAS de la validacion de una entrada del registro (sin disco ni red).
 * Cada funcion devuelve el motivo del fallo (string) o null. El orden en que
 * validacion.mjs las llama es el que decide cual motivo gana: no lo cambies sin mirarlo. */

import { normalize, resolve, sep } from 'node:path';

import { PUERTOS_PROTEGIDOS, RAIZ_REPO } from '../base.mjs';
import { entradaEfectiva, puertoDeSaludValido, validarBloqueBuild } from '../sistema/puertos.mjs';

// [por que 06AA-1] Campos admitidos por el registro: cualquier otro es error de escritura.
// [por que] `procesosAceptados` lo lee cierre.mjs (excepción de procesos propios, b4ac545); sin él el doctor marcaba deriva.
const CONOCIDAS = new Set(['id', 'ruta', 'boton', 'puertos', 'procesosAceptados', 'healths', 'timeoutMs', 'arranqueMs', 'expectedCmdline', 'tipoLauncher', 'dominio', 'requiere', 'env', 'reconstruir', 'auxiliares', 'comandos', 'host', 'analisisEn', 'envRemoto', 'botonRemoto', 'puertosRemotos', 'puertosLocales', 'tunelSsh', 'tunelesExtra', 'tunelPortatil', 'hostsPublicos', 'puertosPublicos', 'buildMode', 'precompilar', 'dependencias', 'modo', 'build', 'envTareas', 'tokenPulse', 'higieneRust', 'despliegue', 'consumeArtefacto', 'appEscritorio', 'sinServicio', 'permanente', 'supervisar', 'notaModo']);
// [por que] `appEscritorio.instalado` lo lee el atribuidor de puertos (esAppInstalada) para no
// dar por hueco el exe de la app de escritorio del propio proyecto; sin la clave, el registro se rechaza.

// [por que 06AA-1] Un aviso sin id no tiene a quien anotarse: solo con id valido se puede marcar la entrada.
export const idValido = (e) => typeof e.id === 'string' && e.id.length > 0;

// [por que] `sinServicio` debe ser booleano; se valida ANTES de exigir claves para que la causa sea la marca.
export function motivoTipoSinServicio(e) {
  if ('sinServicio' in e && typeof e.sinServicio !== 'boolean' && idValido(e)) return `registro: '${e.id}' sinServicio debe ser booleano`;
  return null;
}

export function motivoClaveDesconocida(e) {
  const k = Object.keys(e).find((c) => !CONOCIDAS.has(c));
  return k === undefined ? null : `registro: clave desconocida '${k}' en '${e.id}'`;
}

// [por que] envTareas, tokenPulse, higieneRust y permanente son banderas del proyecto:
// antes se deducian comparando `id` con un nombre concreto; ahora las declara el registro.
// [por que] `permanente` (antes `supervisar`, que sigue valiendo como alias) es EL protocolo de
// estado permanente: la lee el `up` remoto (ciclo.mjs) para grabar el arranque y meter el proceso
// en un bucle de reinicio, el vigilante de la 89 repite lo grabado y el supervisor del tablero
// rearma el túnel del portátil (src/server/taller/tuneles.ts). Una sola bandera, tres tramos.
export function motivoBanderas(e) {
  const k = ['envTareas', 'tokenPulse', 'higieneRust', 'permanente', 'supervisar'].find((c) => c in e && typeof e[c] !== 'boolean');
  return k === undefined ? null : `registro: '${e.id}' ${k} debe ser booleano`;
}

// Una sola lectura de la bandera para todo el que la necesite (up, stop, supervisor del tablero
// y el propio tablero): `supervisar` sigue valiendo como alias deprecado, no como segunda verdad.
export const esPermanente = (entrada) => entrada?.permanente === true || entrada?.supervisar === true;

// [por que] `host` = la entrada corre en esa VPS (scripts/dev/remoto.mjs). Solo el nombre; que coincida con taller.json lo exige remoto.mjs (fail-closed).
export function motivoHost(e) {
  return 'host' in e && (typeof e.host !== 'string' || e.host.trim() === '') ? `registro: '${e.id}' host debe ser un alias no vacio` : null;
}

// [por que] Sin servicio no hay boton, puertos ni marcador: si vienen, contradicen la marca.
export function motivoSinServicioCampos(e) {
  return ['boton', 'puertos', 'expectedCmdline'].some((k) => k in e) ? `registro: '${e.id}' sinServicio no admite boton, puertos ni expectedCmdline` : null;
}

// [por que] El mando gestiona proyectos hermanos: el area valida es la
// carpeta que contiene a este repo, no este repo solo.
export function motivoAreaRuta(e, rutaAbs) {
  const areaNorm = normalize(resolve(RAIZ_REPO, '..'));
  return rutaAbs !== areaNorm && !rutaAbs.startsWith(areaNorm + sep) ? `registro: '${e.id}' ruta fuera del area (${e.ruta})` : null;
}

// [por que] El binario absoluto no necesita args (longitud 1 vale); el resto
// exige exe + args para que el `up` sepa que lanzar sin suposiciones.
// [por que] Un proyecto sin servicio (`sinServicio`) no tiene botón: boton vacío es su forma correcta.
export function motivoBoton(e, sinServicio) {
  const malForma = !Array.isArray(e.boton) || (e.boton.length === 0 && !sinServicio) || e.boton.some((a) => !Array.isArray(a) || a.some((t) => typeof t !== 'string' || t.length === 0) || (a.length < 2 && !(/^[a-z]:[\\/]/i.test(a[0]) && a[0].toLowerCase().endsWith('.exe'))));
  return malForma ? `registro: '${e.id}' boton debe ser array de argv (arrays de >=2 strings)` : null;
}

export function motivoPuertos(e) {
  return !Array.isArray(e.puertos) || e.puertos.some((p) => !Number.isInteger(p) || p < 1 || p > 65535) ? `registro: '${e.id}' puertos invalidos` : null;
}

// [por que] `env` fija puertos/URLs por proyecto sin tocar sus repos
// (PORT/VITE_API_URL/VITE_PORT): el mando compone el entorno, cada repo
// conserva sus defaults. Solo strings no vacios; nada de objetos.
export function motivoEnv(e) {
  if (!('env' in e)) return null;
  if (typeof e.env !== 'object' || e.env === null || Array.isArray(e.env)) return `registro: '${e.id}' env no es objeto`;
  const malEntrada = Object.entries(e.env).find(([, v]) => typeof v !== 'string' || v.length === 0);
  return malEntrada ? `registro: '${e.id}' env['${malEntrada[0]}'] debe ser string no vacio` : null;
}

// [por que] Campos del taller (14AA-5): los lee la conformidad (src/shared/taller/conformidad.ts),
// el mando solo los valida para no marcar deriva a una entrada bien declarada.
// [por que] tunelSsh: lo lee remoto.mjs (false = la VPS expone sus puertos sola; sin túnel no hay puertosLocales).
// [por que] tunelesExtra: reenvíos declarados que no salen de `puertos` ni del
// bloque `build` (el puente del gateway de MN: 33110 -> 3110 de la 89). Sin
// esto el túnel del proyecto salía huérfano «(sin proyecto)».
export function motivoCamposTaller(e) {
  if ('hostsPublicos' in e && (!Array.isArray(e.hostsPublicos) || e.hostsPublicos.some((h) => typeof h !== 'string' || h === ''))) return `registro: '${e.id}' hostsPublicos debe ser array de hostnames`;
  if ('puertosPublicos' in e && (!Array.isArray(e.puertosPublicos) || e.puertosPublicos.some((p) => !Number.isInteger(p) || p < 1 || p > 65535))) return `registro: '${e.id}' puertosPublicos invalidos`;
  if ('tunelSsh' in e && typeof e.tunelSsh !== 'boolean') return `registro: '${e.id}' tunelSsh debe ser true o false`;
  if ('tunelesExtra' in e && (!Array.isArray(e.tunelesExtra) || e.tunelesExtra.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isInteger(n) || n < 1024 || n > 65535)))) return `registro: '${e.id}' tunelesExtra debe ser array de pares [local, remoto] (1024-65535)`;
  // [por que] tunelPortatil: reenvíos que el PORTÁTIL necesita para sí y que no salen de `puertos`
  // (una app local que habla con el servicio por un puerto fijo, p. ej.). El supervisor del tablero
  // los rearma junto con los del proyecto. `tunelesExtra` no sirve para eso: es del proyecto.
  if ('tunelPortatil' in e && (!Array.isArray(e.tunelPortatil) || e.tunelPortatil.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isInteger(n) || n < 1024 || n > 65535)))) return `registro: '${e.id}' tunelPortatil debe ser array de pares [local, remoto] (1024-65535)`;
  return null;
}

// [por que S3.7] analisisEn: dónde corre el análisis Sentinel/VarSense del gate. Ausente =
// lo que diga el taller. El alias del host se sigue aceptando: era el valor con el que se
// escribía antes de que el modo se llamara por su papel.
export function motivoAnalisisEn(e, aliasTaller) {
  const modosValidos = aliasTaller ? ['local', 'taller', aliasTaller] : ['local', 'taller'];
  if (!('analisisEn' in e) || modosValidos.includes(e.analisisEn)) return null;
  return `registro: '${e.id}' analisisEn debe ser 'local', 'taller' o el host del taller${aliasTaller ? ` ('${aliasTaller}')` : ' (ninguno declarado)'}`;
}

export function motivoBuildMode(e) {
  return 'buildMode' in e && (typeof e.buildMode !== 'string' || e.buildMode === '') ? `registro: '${e.id}' buildMode debe ser string no vacio` : null;
}

// [por que] argv[i] <-> puertos[i]: sin igualdad posicional el `up` no sabe
// que lanzar ante un puerto caido y cualquier suposicion seria verde fingido.
export function motivoAlineacion(e) {
  return e.boton.length !== e.puertos.length ? `registro: '${e.id}' boton (${e.boton.length}) y puertos (${e.puertos.length}) deben alinearse 1:1` : null;
}

// [por que] 8787/5175 son del propio manager y 5174 de opencode-propio:
// ningun OTRO proyecto puede reclamarlos; la entrada raiz si (self).
export function motivoPuertoProtegido(e, rutaAbs) {
  if (rutaAbs === normalize(RAIZ_REPO)) return null;
  for (const p of e.puertos) {
    if (PUERTOS_PROTEGIDOS.has(p)) return `registro: '${e.id}' usa puerto protegido ${p}`;
  }
  return null;
}

export function motivoHealths(e) {
  const healths = e.healths ?? [];
  if (!Array.isArray(healths)) return `registro: '${e.id}' healths no es array`;
  for (const h of healths) {
    const motivo = motivoHealth(e, h);
    if (motivo) return motivo;
  }
  return null;
}

// [por que] Health sin ruta valida = probe contra el(Query) puerto sin
// saber que pedir: el verde seria fingido. Sin validacion, un typo
// (`ruta: 'api/x'` sin barra) pasa callado y el probe falla como deriva.
// [por que] En modo build el `/` lo sirve el backend Rust, así que un 200 puede ser la API y no
// la SPA: el marcador es lo que distingue una de otra. Corto = se cumpliría por casualidad.
function motivoHealth(e, h) {
  if (!Number.isInteger(h?.puerto) || !puertoDeSaludValido(h.puerto, e)) return `registro: '${e.id}' health con puerto fuera de la entrada`;
  if (typeof h.ruta !== 'string' || !h.ruta.startsWith('/')) return `registro: '${e.id}' health sin ruta absoluta (puerto ${h.puerto})`;
  if ('esperaJson' in h && typeof h.esperaJson !== 'boolean') return `registro: '${e.id}' health esperaJson no booleano (puerto ${h.puerto})`;
  if ('marcador' in h && (typeof h.marcador !== 'string' || h.marcador.length < 3 || h.marcador.length > 120)) return `registro: '${e.id}' health marcador debe ser texto de 3 a 120 (puerto ${h.puerto})`;
  const k = Object.keys(h).find((c) => !['puerto', 'ruta', 'esperaJson', 'marcador'].includes(c));
  return k === undefined ? null : `registro: '${e.id}' health con clave desconocida '${k}'`;
}

export function motivoBloqueBuild(e) {
  const malBuild = validarBloqueBuild(e);
  return malBuild ? `registro: '${e.id}' ${malBuild}` : null;
}

// [por que] Dominio .localhost = URL con nombre por proyecto sin tocar
// hosts ni pedir administrador (el navegador lo resuelve a loopback).
// Formato cerrado: solo <slug>.localhost; nada publico, nada configurable.
// [por que] `dominio: null` es válido en un proyecto sin servicio de red.
export function motivoDominio(e) {
  return 'dominio' in e && e.dominio !== null && (typeof e.dominio !== 'string' || !/^[a-z0-9-]{1,40}\.localhost$/.test(e.dominio)) ? `registro: '${e.id}' dominio debe ser <slug>.localhost` : null;
}

// [por que] `requiere` = dependencias de arranque (p. ej.
// workspace-manager necesita pulse: sin el, el panel VPS se queda en
// "conectando con pulse..." para siempre). Forma: array de ids del
// registro, sin autorreferencia; la existencia se valida en leerRegistro
// (aqui aun no se conocen todos los ids) y los ciclos en `up`.
export function motivoRequiere(e) {
  if (!('requiere' in e)) return null;
  if (!Array.isArray(e.requiere) || e.requiere.some((d) => typeof d !== 'string' || d.length === 0)) return `registro: '${e.id}' requiere debe ser array de ids (strings no vacios)`;
  if (e.requiere.includes(e.id)) return `registro: '${e.id}' se requiere a si mismo`;
  return null;
}

// [por que] F0d: nuevo launcher = campo tipoLauncher + checklist, no `if`
// en codigo. Si viene, debe decir algo (string no vacio); el contenido lo
// documenta el onboarding, el doctor solo exige que exista con forma.
// [por que] timeoutMs = probe puntual; arranqueMs = compilacion fria
// (cargo). Confundirlos deja un arranque real fuera de tiempo o un probe
// colgado minutos. Tope 5 min: mas alla es pipeline, no `up`.
export function motivoLanzamiento(e) {
  if ('tipoLauncher' in e && (typeof e.tipoLauncher !== 'string' || e.tipoLauncher.length === 0)) return `registro: '${e.id}' tipoLauncher vacio`;
  if ('timeoutMs' in e && (!Number.isInteger(e.timeoutMs) || e.timeoutMs < 500 || e.timeoutMs > 30000)) return `registro: '${e.id}' timeoutMs fuera de 500..30000`;
  if ('arranqueMs' in e && (!Number.isInteger(e.arranqueMs) || e.arranqueMs < 5000 || e.arranqueMs > 300000)) return `registro: '${e.id}' arranqueMs fuera de 5000..300000`;
  return null;
}

// [por que] auxiliares: listeners del proyecto que NO son de su mando (p. ej.
// un script lanzado a mano). Fuera de `puertos`: si estan abajo no hay
// deriva; si estan arriba con el marcador en su cmd, son del proyecto.
// [por que 16AA-20] Que un puerto sea del mando depende del modo: en `build`
// el mando sirve los del bloque y el resto no son suyos. Se compara contra los
// puertos efectivos, no contra los de la ficha.
export function motivoAuxiliares(e) {
  if (!('auxiliares' in e)) return null;
  if (!Array.isArray(e.auxiliares)) return `registro: '${e.id}' auxiliares no es array`;
  const gestionados = new Set(entradaEfectiva(e).puertos ?? []);
  const todosValidos = e.auxiliares.every((a) => {
    const enPuertos = gestionados.has(a?.puerto);
    return typeof a === 'object' && a !== null &&
      Number.isInteger(a.puerto) && a.puerto >= 1 && a.puerto <= 65535 && !enPuertos &&
      typeof a.marcador === 'string' && a.marcador.length >= 3 && a.marcador.length <= 120 &&
      typeof a.motivo === 'string' && a.motivo.length >= 3 && a.motivo.length <= 120;
  });
  return todosValidos ? null : `registro: '${e.id}' auxiliares: cada entrada exige puerto (fuera de puertos), marcador (3-120) y motivo (3-120)`;
}

// [por que] Servicios con hijos heterogeneos (backend Rust compilado en
// C:\tmp + frontend Vite bajo la ruta) no comparten ningun substring en
// sus cmdlines: un marcador unico deja un puerto en deriva en el camino
// feliz. Array alinea con puertos (igual que boton): string sigue valiendo
// cuando un marcador cubre todos (compat v1).
export function motivoExpectedCmdline(e) {
  if (typeof e.expectedCmdline !== 'string' && !Array.isArray(e.expectedCmdline)) return `registro: '${e.id}' expectedCmdline vacio`;
  if (!Array.isArray(e.expectedCmdline)) return e.expectedCmdline.length === 0 ? `registro: '${e.id}' expectedCmdline vacio` : null;
  if (e.expectedCmdline.length !== e.puertos.length) return `registro: '${e.id}' expectedCmdline (${e.expectedCmdline.length}) y puertos (${e.puertos.length}) deben alinearse 1:1`;
  const malMarcador = e.expectedCmdline.some((m) => typeof m !== 'string' || m.length === 0);
  return malMarcador ? `registro: '${e.id}' expectedCmdline con marcador vacio` : null;
}
