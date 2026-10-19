/* Escrituras (POST) del Guardián (10AA-2 F11.4). [por que] Cada escritura pasa por las
 * guardas de origen (Origin, Host, Content-Type) y por el escritor seguro de guardian/
 * (hash previo, reverificación, escritura atómica). Las lecturas viven en rutasGuardian.ts. */
import type { ServerResponse } from 'node:http';
import { json, leerBody } from '../../http.js';
import { verificarPeticionEscritura } from '../../guardian/operacion/seguridad.js';
import {
  calcularEdicion,
  ErrorValidacion,
  guardarEdicion,
  guardarLote,
  leerPolitica,
  validarCambio,
} from '../../guardian/configuracion/politica.js';
import { comprobarRegistrada } from '../../guardian/operacion/probar.js';
import { calcularEdicionPlantilla, guardarEdicionPlantilla } from '../../guardian/configuracion/plantilla.js';
import { calcularTopes, guardarTopes, validarCambioTopes } from '../../guardian/configuracion/topes.js';
import type { EntradaMantenimiento } from '../../guardian/operacion/mantenimiento.js';
import type { Contexto } from './rutasGuardianTipos.js';
/* [por que] `esObjeto` se importa de su dueno (shared/guardas) y no de las
 * ayudas: la ayuda solo lo reexportaba, un paso de mas que ocultaba de donde
 * venia la guarda. */
import { esObjeto } from '../../../shared/guardas.js';
import {
  booleanoDe,
  confirmarDe,
  contextoPlantilla,
  entradasLote,
  hashesDeTexto,
  hashesTopesDe,
  proyectoElegible,
  responderEdicion,
  resumenEdicion,
  textoRequerido,
  vistaPreviaLote,
} from './rutasGuardianAyudas.js';

/* Guardas de origen antes de leer el cuerpo: una petición ajena no llega a
 * parsear nada. Devuelve null si ya respondió el error. */
async function cuerpoPost(c: Contexto): Promise<Record<string, unknown> | null> {
  const veredicto = verificarPeticionEscritura(c.req.headers);
  if (!veredicto.ok) {
    json(c.res, veredicto.status, { error: veredicto.motivo });
    return null;
  }
  let cuerpo: unknown;
  try {
    cuerpo = await leerBody(c.req);
  } catch (err) {
    json(c.res, 400, { error: 'Cuerpo JSON no válido o demasiado grande', detalle: String(err) });
    return null;
  }
  if (!esObjeto(cuerpo)) {
    json(c.res, 400, { error: 'El cuerpo debe ser un objeto JSON' });
    return null;
  }
  return cuerpo;
}

export async function editarPolitica(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const proyecto = await proyectoElegible(c.deps, cuerpo.clave);
  const hashPrevio = textoRequerido(cuerpo.hashPrevio, 'hashPrevio');
  const cambio = validarCambio(cuerpo.cambio);
  const contexto = cambio.aplicarPlantilla ? contextoPlantilla(c.deps, proyecto.clave) : undefined;
  const confirmar = confirmarDe(cuerpo);
  const r = confirmar
    ? guardarEdicion(proyecto.ruta, hashPrevio, cambio, contexto)
    : calcularEdicion(proyecto.ruta, hashPrevio, cambio, contexto);
  responderEdicion(c.res, r, confirmar);
}

export async function editarTopes(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const proyecto = await proyectoElegible(c.deps, cuerpo.clave);
  const previo = hashesTopesDe(cuerpo.hashes);
  const cambio = validarCambioTopes(cuerpo.cambio);

  if (!confirmarDe(cuerpo)) {
    const r = calcularTopes(proyecto.ruta, previo, cambio);
    if (r.estado !== 'ok') {
      json(c.res, r.estado === 'conflicto' ? 409 : 422, { estado: r.estado, motivo: r.motivo });
      return;
    }
    json(c.res, 200, {
      estado: 'ok',
      escrito: false,
      cambia: r.plan.cambia,
      diffConfig: r.plan.diffConfig,
      diffExtra: r.plan.diffExtra,
      hashesNuevos: hashesDeTexto(r.plan),
    });
    return;
  }

  const r = guardarTopes(proyecto.ruta, previo, cambio);
  if (r.estado === 'ok') {
    json(c.res, 200, {
      estado: 'ok',
      escrito: r.cambia,
      cambia: r.cambia,
      diffConfig: r.diffConfig,
      diffExtra: r.diffExtra,
      hashes: r.hashes,
    });
    return;
  }
  if (r.estado === 'conflicto') {
    json(c.res, 409, { estado: 'conflicto', motivo: r.motivo });
    return;
  }
  /* [por que] configRevertida definido = la configuración se escribió y el fallo
   * vino después: si no se pudo revertir, el área queda a medias y es un 500. */
  const status = r.configRevertida !== undefined ? 500 : 422;
  json(c.res, status, { estado: 'error', motivo: r.motivo, configRevertida: r.configRevertida });
}

export async function editarLote(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const entradas = await entradasLote(c.deps, cuerpo.entradas);
  const confirmar = confirmarDe(cuerpo);
  /* [por que] guardarLote escribe o no escribe nada (todo o nada); la vista previa
   * calcula cada entrada sin tocar ningún fichero. */
  const r = confirmar ? guardarLote(entradas) : vistaPreviaLote(entradas);

  if (r.error !== undefined) {
    json(c.res, 500, {
      estado: 'error',
      error: r.error,
      revertidas: r.revertidas,
      sinRevertir: r.sinRevertir,
    });
    return;
  }
  const resultados = r.resultados.map(({ clave, resultado }) => ({ clave, ...resumenEdicion(resultado) }));
  if (!r.ok) {
    const conflicto = r.resultados.some(({ resultado }) => resultado.estado === 'conflicto');
    json(c.res, conflicto ? 409 : 422, { estado: conflicto ? 'conflicto' : 'error', resultados });
    return;
  }
  json(c.res, 200, { estado: 'ok', escrito: confirmar, resultados });
}

export async function editarPlantilla(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const hashPrevio = textoRequerido(cuerpo.hashPrevio, 'hashPrevio');
  const confirmar = confirmarDe(cuerpo);
  const r = confirmar
    ? guardarEdicionPlantilla(c.deps.dirConfig, hashPrevio, cuerpo.plantilla)
    : calcularEdicionPlantilla(c.deps.dirConfig, hashPrevio, cuerpo.plantilla);
  responderEdicion(c.res, r, confirmar);
}

/* Ejecuta un comando de prueba en el proyecto para ver qué decide el guard. Solo
 * proyectos elegibles: el comando corre en su raíz y con sus reglas. */
export async function probarRuta(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const proyecto = await proyectoElegible(c.deps, cuerpo.clave);
  const ejecutable = textoRequerido(cuerpo.ejecutable, 'ejecutable');
  if (!Array.isArray(cuerpo.args)) throw new ErrorValidacion('args debe ser una lista de textos');
  /* [por que] Sin política válida no hay registro que comprobar: se rechaza en vez de
   * sondear a ciegas. */
  const politica = leerPolitica(proyecto.ruta);
  if (politica.estado !== 'ok') {
    throw new ErrorValidacion('el proyecto no tiene una política del Guardián válida: no hay registro que comprobar');
  }
  comprobarRegistrada(ejecutable, politica.listas);
  const args: string[] = cuerpo.args;
  const r = await c.deps.probarComando({ raiz: proyecto.ruta, ejecutable, args });
  json(c.res, 200, r);
}

/* [por que] Solo se copian los tres campos que la página puede pedir. La raíz y
 * los destinos los fija el servidor: el cliente no elige qué directorio se toca. */
export async function mantenimientoRuta(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const entrada: EntradaMantenimiento = {};
  if (cuerpo.conShims !== undefined) entrada.conShims = booleanoDe(cuerpo.conShims, 'conShims');
  if (cuerpo.conPerfiles !== undefined) entrada.conPerfiles = booleanoDe(cuerpo.conPerfiles, 'conPerfiles');
  if (cuerpo.confirmar !== undefined) entrada.confirmar = booleanoDe(cuerpo.confirmar, 'confirmar');
  json(c.res, 200, await c.deps.ejecutarMantenimiento(entrada));
}
