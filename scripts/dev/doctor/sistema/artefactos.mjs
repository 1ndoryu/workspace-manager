/* Artefactos entre proyectos (20AA-7): un proyecto que empotra el artefacto de
 * compilacion de otro.
 *
 * [por que] `MN-Escritorio` mete el `frontend/dist` de `MN-Inmobiliaria` dentro
 * del `.exe` al compilar. Nada lo declaraba, asi que cambiar el front dejaba el
 * `.exe` viejo sin que nadie avisara. No hay exe viejo *silencioso*
 * (`tauri-build` emite `cargo:rerun-if-changed` del front y cargo lo respeta,
 * medido el 2026-10-20: 0,31 s sin cambios / 55,10 s tras tocar el dist), pero si
 * olvidarse de compilar: eso es lo que se vigila aqui.
 *
 * [por que] Sin sello en disco: un sello hay que escribirlo justo cuando se
 * olvida lo demas. Se comparan hechos que ya existen, todo lectura:
 *   1. mtime del consumido contra mtime del producto, los dos en la 89: misma
 *      maquina, sin desfase de reloj. Del consumido se toma el archivo MAS
 *      NUEVO del arbol, no el directorio: Vite reescribe `index.html` en su
 *      sitio y no toca el mtime de `dist/` (medido: el directorio iba 19,6 h por
 *      detras del archivo mas nuevo), asi que un `stat` del directorio daria
 *      «al dia» con el exe viejo justo en el caso que esto existe para evitar.
 *   2. sha256 del producto contra el de la copia instalada en el portatil:
 *      exacto y cruza maquinas sin fiarse de relojes.
 *
 * Las dos comparaciones cubren las dos formas de olvidarse un paso:
 * `desactualizado` = «el exe no embebe el front nuevo»; `instalado-distinto` =
 * «compilaste pero no instalaste». */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { cargarConfig, detectarRama, rutasRemotas, shQuote } from '../../../remoto/rcargo.mjs';
import { sshRemoto } from '../../remoto/ssh.mjs';
import { RAIZ_REPO } from '../base.mjs';

/* Veredictos. `al-dia` no es aviso: solo sale con `todos`. */
export const VEREDICTOS = ['al-dia', 'desactualizado', 'sin-producto', 'sin-instalar', 'instalado-distinto', 'sin-dato'];

/* Consumido y producto en la 89, en un solo viaje de ssh (~2,7 s medidos).
 * [por que] El consumido se busca con `find` porque puede ser carpeta o archivo
 * y porque del arbol interesa el archivo mas nuevo (ver cabecera). `2>/dev/null`
 * y las ramas `else`: que falte algo es un veredicto, no un error. */
function comandoSonda(consumido, producto) {
  const c = shQuote(consumido);
  const p = shQuote(producto);
  return [
    `if [ -e ${c} ]; then`,
    `echo "consumido=$(find ${c} -type f -printf '%T@\\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)";`,
    'else echo consumido=; fi;',
    `if [ -f ${p} ]; then`,
    `echo "producto=$(stat -c %Y ${p})";`,
    `echo "hash=$(sha256sum ${p} | cut -d' ' -f1)";`,
    'else echo producto=; echo hash=; fi',
  ].join(' ');
}

function parsear(salida) {
  const campos = {};
  for (const linea of String(salida).split(/\r?\n/)) {
    const i = linea.indexOf('=');
    if (i > 0) campos[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
  }
  return campos;
}

/* Veredicto a partir de hechos ya medidos. Puro: los tests lo fijan sin ssh. */
export function veredicto({ consumidoEn, productoEn, hashProducto, tieneInstalado, hashInstalado }) {
  if (!consumidoEn) return { veredicto: 'sin-dato', detalle: 'no existe lo consumido en la 89 (¿falta compilar ese proyecto?)' };
  if (!productoEn) return { veredicto: 'sin-producto', detalle: 'el producto no esta compilado' };
  if (Number(productoEn) < Number(consumidoEn)) {
    return { veredicto: 'desactualizado', detalle: `producto ${desde(productoEn)} < consumido ${desde(consumidoEn)}` };
  }
  if (!tieneInstalado) return { veredicto: 'sin-instalar', detalle: 'hay producto compilado pero no copia instalada' };
  if (hashProducto && hashInstalado && hashProducto !== hashInstalado) {
    return { veredicto: 'instalado-distinto', detalle: `instalado ${hashInstalado.slice(0, 12)} != compilado ${hashProducto.slice(0, 12)}` };
  }
  return { veredicto: 'al-dia', detalle: `producto ${desde(productoEn)}, consumido ${desde(consumidoEn)}` };
}

const desde = (t) => new Date(Number(t) * 1000).toISOString().replace('T', ' ').slice(0, 19);

function sha256De(ruta) {
  try {
    return createHash('sha256').update(readFileSync(ruta)).digest('hex');
  } catch {
    return null;
  }
}

/* Una entrada con `consumeArtefacto` -> rutas en la 89 del consumido y del producto. */
function rutasDe(e, config) {
  const a = e.consumeArtefacto;
  const rutaLocal = isAbsolute(e.ruta) ? e.ruta : resolve(RAIZ_REPO, e.ruta);
  const target = rutasRemotas(config, e.id, detectarRama(rutaLocal)).target;
  return {
    consumido: `${config.dirRemotoBase}/${a.proyecto}/${a.ruta}`,
    producto: `${target}/${a.producto}`,
  };
}

/* Avisos de artefactos, uno por entrada que declare `consumeArtefacto`.
 * Fail-soft: sin taller.json o sin ssh se devuelve `sin-dato`, nunca se lanza
 * (el doctor no puede caerse por esto). `opts.todos` incluye tambien los
 * `al-dia`, que en el informe son ruido. */
export async function detectarArtefactos(registro, opts = {}) {
  const entradas = [...(registro.entradas?.values() ?? [])].filter((e) => e.consumeArtefacto && typeof e.ruta === 'string');
  if (entradas.length === 0) return [];
  let config;
  try {
    config = cargarConfig();
  } catch (err) {
    return entradas.map((e) => aviso(e, 'sin-dato', `sin taller.json (${err.message}): no se puede situar nada en la 89`));
  }
  const avisos = [];
  for (const e of entradas) {
    const a = e.consumeArtefacto;
    const { consumido, producto } = rutasDe(e, config);
    const r = await sshRemoto(config, comandoSonda(consumido, producto));
    if (!r.ok) {
      avisos.push(aviso(e, 'sin-dato', `sin ssh a ${config.host}: ${r.error}`));
      continue;
    }
    const c = parsear(r.salida);
    const instalado = a.instalado;
    const v = veredicto({
      consumidoEn: c.consumido,
      productoEn: c.producto,
      hashProducto: c.hash,
      tieneInstalado: Boolean(instalado) && existsSync(instalado),
      hashInstalado: instalado ? sha256De(instalado) : null,
    });
    avisos.push(aviso(e, v.veredicto, v.detalle));
  }
  return opts.todos ? avisos : avisos.filter((x) => x.veredicto !== 'al-dia');
}

function aviso(e, veredicto, detalle) {
  const a = e.consumeArtefacto;
  return { proyecto: e.id, consumido: `${a.proyecto}:${a.ruta}`, veredicto, detalle };
}

/* Lineas para la tabla del mando `artefactos` (y para el aviso del doctor). */
export function lineasArtefactos(avisos) {
  if (avisos.length === 0) return ['artefactos: al dia'];
  return avisos.map((a) => `artefactos: ${a.proyecto} <- ${a.consumido} [${a.veredicto}] ${a.detalle}`);
}
