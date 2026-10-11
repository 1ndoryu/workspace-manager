/* Rutas del Guardián (/api/guardian/*, 10AA-2 F11.4): la pestaña de primer nivel
 * que controla la política, los topes, la plantilla y el mantenimiento del guard
 * de todos los proyectos elegibles. [por que] Sustituye a /api/guard/* (D6: la
 * interfaz anterior se retira). Las lecturas solo leen ficheros; cada escritura
 * pasa por las guardas de origen (Origin, Host, Content-Type) y por el escritor
 * seguro de guardian/ (hash previo, reverificación, escritura atómica). Devuelve
 * true si atendió la ruta, false si no es suya. */
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, leerBody } from '../http.js';
import { snapshotArea } from '../snapshot.js';
import { esElegible } from '../gate/analizador.js';
import type { Proyecto } from '../../shared/types.js';
import { leerGuardProyecto } from '../guardian/configuracion/lector.js';
import {
  calcularEdicion,
  ErrorValidacion,
  guardarEdicion,
  guardarLote,
  leerPolitica,
  validarCambio,
  type EdicionLote,
  type Listas,
  type Plantilla,
  type ResultadoEdicion,
  type ResultadoLote,
} from '../guardian/configuracion/politica.js';
import {
  calcularEdicionPlantilla,
  guardarEdicionPlantilla,
  leerPlantilla,
  RUTA_PLANTILLA,
} from '../guardian/configuracion/plantilla.js';
import {
  calcularTopes,
  CONFIG,
  EXTRA,
  guardarTopes,
  validarCambioTopes,
  type HashesTopes,
  type PlanTopes,
} from '../guardian/configuracion/topes.js';
import { hashDe, leerFichero, type BloqueDiff } from '../guardian/escritura.js';
import { leerActividad, type FiltrosActividad } from '../guardian/operacion/actividad.js';
import { probarComando } from '../guardian/operacion/probar.js';
import { ejecutarMantenimiento, type EntradaMantenimiento } from '../guardian/operacion/mantenimiento.js';
import { verificarPeticionEscritura } from '../guardian/operacion/seguridad.js';

/* [por que] Desde src/server/rutas (o dist-server/server/rutas) tres niveles suben
 * a la raíz del tablero, donde vive .quality-tools/guard-plantillas.json. */
const RAIZ_TABLERO = join(import.meta.dirname, '..', '..', '..');

/* Límite de proyectos por lote: acota el trabajo de una sola petición. */
const MAX_LOTE = 50;

/* Lo que el router necesita del entorno. Inyectable: los tests usan un snapshot
 * falso y comandos falsos, nunca el área real. */
export interface DependenciasGuardian {
  raizTablero: string;
  proyectos: () => Proyecto[];
  proyectoPorClave: (clave: string) => Proyecto | null;
  leerActividad: typeof leerActividad;
  probarComando: typeof probarComando;
  ejecutarMantenimiento: typeof ejecutarMantenimiento;
}

const proyectosActuales = (): Proyecto[] => snapshotArea(false).snapshot.proyectos;

export const dependenciasReales: DependenciasGuardian = {
  raizTablero: RAIZ_TABLERO,
  proyectos: proyectosActuales,
  proyectoPorClave: (clave) => proyectosActuales().find((p) => p.clave === clave) ?? null,
  leerActividad,
  probarComando,
  ejecutarMantenimiento,
};

interface Contexto {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  deps: DependenciasGuardian;
}

type Manejador = (c: Contexto) => Promise<void>;

/* [por que] Clave «MÉTODO ruta»: una ruta con otro método responde 405 y una ruta
 * desconocida no es nuestra (devuelve false y la resuelve el siguiente módulo). */
const RUTAS = new Map<string, Manejador>([
  ['GET /api/guardian/estado', estadoProyecto],
  ['GET /api/guardian/estado-todo', estadoArea],
  ['GET /api/guardian/plantilla', verPlantilla],
  ['GET /api/guardian/actividad', verActividad],
  ['POST /api/guardian/politica', editarPolitica],
  ['POST /api/guardian/topes', editarTopes],
  ['POST /api/guardian/lote', editarLote],
  ['POST /api/guardian/plantilla', editarPlantilla],
  ['POST /api/guardian/probar', probarRuta],
  ['POST /api/guardian/mantenimiento', mantenimientoRuta],
]);
const RUTAS_CONOCIDAS = new Set([...RUTAS.keys()].map((k) => k.slice(k.indexOf(' ') + 1)));

export async function manejarRutasGuardian(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
  deps: DependenciasGuardian = dependenciasReales,
): Promise<boolean> {
  if (!ruta.startsWith('/api/guardian/')) return false;
  const manejador = RUTAS.get(`${req.method} ${ruta}`);
  if (!manejador) {
    if (!RUTAS_CONOCIDAS.has(ruta)) return false;
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  await conErrores({ req, res, url, deps }, manejador);
  return true;
}

/* [por que] Un ErrorValidacion es un dato del cliente (422) y lleva su motivo; lo
 * demás es un fallo del servidor (500) y solo se detalla en el campo `detalle`. */
async function conErrores(c: Contexto, manejador: Manejador): Promise<void> {
  try {
    await manejador(c);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      json(c.res, 422, { error: err.message });
      return;
    }
    json(c.res, 500, { error: 'No se pudo completar la operación del Guardián', detalle: String(err) });
  }
}

/* --- Lecturas (GET) ----------------------------------------------------------- */

/* Estado de la política por listas (npmScripts, npxTools, cargoSubcommands, tools).
 * [por que] La matriz «Comandos» cruza proyecto × comando: necesita las listas,
 * y leerGuardProyecto solo trae modo y topes. Si la política no es legible, la
 * página lo dice con el motivo; no supone listas vacías. */
export type EstadoListas =
  | { estado: 'ok'; listas: Listas }
  | { estado: 'ausente' }
  | { estado: 'invalida'; motivo: string };

function estadoListasDe(ruta: string): EstadoListas {
  const lectura = leerPolitica(ruta);
  if (lectura.estado === 'ok') return { estado: 'ok', listas: lectura.listas };
  if (lectura.estado === 'ausente') return { estado: 'ausente' };
  return { estado: 'invalida', motivo: lectura.motivo };
}

function estadoElegible(clave: string, ruta: string) {
  return { elegible: true as const, ...leerGuardProyecto(clave, ruta), listas: estadoListasDe(ruta) };
}

async function estadoProyecto({ res, url, deps }: Contexto): Promise<void> {
  const clave = url.searchParams.get('clave') ?? '';
  const proyecto = deps.proyectoPorClave(clave);
  if (!proyecto) {
    json(res, 404, { error: 'Proyecto no encontrado', clave });
    return;
  }
  if (!esElegible(proyecto)) {
    json(res, 200, { clave, elegible: false });
    return;
  }
  /* [por que] Los hashes son lo que la página devuelve al guardar (hash previo):
   * sin ellos un guardado no puede detectar que el fichero cambió por fuera. */
  json(res, 200, { ...estadoElegible(clave, proyecto.ruta), hashes: hashesDe(proyecto.ruta) });
}

/* [por que] Barrido agregado sin hashes: son dos lecturas más por proyecto y solo
 * hacen falta al editar, cuando la página pide estadoProyecto. */
async function estadoArea({ res, deps }: Contexto): Promise<void> {
  const proyectos = deps.proyectos();
  json(res, 200, {
    total: proyectos.length,
    proyectos: proyectos.map((p) => (esElegible(p) ? estadoElegible(p.clave, p.ruta) : { clave: p.clave, elegible: false as const })),
  });
}

async function verPlantilla({ res, deps }: Contexto): Promise<void> {
  json(res, 200, leerPlantilla(deps.raizTablero));
}

async function verActividad({ res, url, deps }: Contexto): Promise<void> {
  const sp = url.searchParams;
  const filtros: FiltrosActividad = {};
  const proyecto = sp.get('proyecto');
  const comando = sp.get('comando');
  const decision = sp.get('decision');
  const limite = sp.get('limite');
  if (proyecto !== null) filtros.proyecto = proyecto;
  if (comando !== null) filtros.comando = comando;
  /* [por que] El cast solo cubre el tipo: leerActividad valida el valor y lanza
   * ErrorValidacion (422) si no es una decisión conocida. */
  if (decision !== null) filtros.decision = decision as FiltrosActividad['decision'];
  if (limite !== null) filtros.limite = Number(limite);
  json(res, 200, deps.leerActividad(filtros));
}

/* --- Escrituras (POST) -------------------------------------------------------- */

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

async function editarPolitica(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const proyecto = proyectoElegible(c.deps, cuerpo.clave);
  const hashPrevio = textoRequerido(cuerpo.hashPrevio, 'hashPrevio');
  const cambio = validarCambio(cuerpo.cambio);
  const contexto = cambio.aplicarPlantilla ? contextoPlantilla(c.deps, proyecto.clave) : undefined;
  const confirmar = confirmarDe(cuerpo);
  const r = confirmar
    ? guardarEdicion(proyecto.ruta, hashPrevio, cambio, contexto)
    : calcularEdicion(proyecto.ruta, hashPrevio, cambio, contexto);
  responderEdicion(c.res, r, confirmar);
}

async function editarTopes(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const proyecto = proyectoElegible(c.deps, cuerpo.clave);
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

async function editarLote(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const entradas = entradasLote(c.deps, cuerpo.entradas);
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

async function editarPlantilla(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const hashPrevio = textoRequerido(cuerpo.hashPrevio, 'hashPrevio');
  const confirmar = confirmarDe(cuerpo);
  const r = confirmar
    ? guardarEdicionPlantilla(c.deps.raizTablero, hashPrevio, cuerpo.plantilla)
    : calcularEdicionPlantilla(c.deps.raizTablero, hashPrevio, cuerpo.plantilla);
  responderEdicion(c.res, r, confirmar);
}

/* Ejecuta un comando de prueba en el proyecto para ver qué decide el guard. Solo
 * proyectos elegibles: el comando corre en su raíz y con sus reglas. */
async function probarRuta(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const proyecto = proyectoElegible(c.deps, cuerpo.clave);
  const ejecutable = textoRequerido(cuerpo.ejecutable, 'ejecutable');
  if (!Array.isArray(cuerpo.args)) throw new ErrorValidacion('args debe ser una lista de textos');
  const args: string[] = cuerpo.args;
  const r = await c.deps.probarComando({ raiz: proyecto.ruta, ejecutable, args });
  json(c.res, 200, r);
}

/* [por que] Solo se copian los tres campos que la página puede pedir. La raíz y
 * los destinos los fija el servidor: el cliente no elige qué directorio se toca. */
async function mantenimientoRuta(c: Contexto): Promise<void> {
  const cuerpo = await cuerpoPost(c);
  if (!cuerpo) return;
  const entrada: EntradaMantenimiento = {};
  if (cuerpo.conShims !== undefined) entrada.conShims = booleanoDe(cuerpo.conShims, 'conShims');
  if (cuerpo.conPerfiles !== undefined) entrada.conPerfiles = booleanoDe(cuerpo.conPerfiles, 'conPerfiles');
  if (cuerpo.confirmar !== undefined) entrada.confirmar = booleanoDe(cuerpo.confirmar, 'confirmar');
  json(c.res, 200, await c.deps.ejecutarMantenimiento(entrada));
}

/* --- Ayudas ------------------------------------------------------------------- */

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function textoRequerido(valor: unknown, nombre: string): string {
  if (typeof valor !== 'string' || valor === '' || valor.length > 512) {
    throw new ErrorValidacion(`${nombre} debe ser texto de 1 a 512 caracteres`);
  }
  return valor;
}

function booleanoDe(valor: unknown, nombre: string): boolean {
  if (typeof valor !== 'boolean') throw new ErrorValidacion(`${nombre} debe ser true o false`);
  return valor;
}

/* Ausente = vista previa. Solo `confirmar: true` escribe. */
function confirmarDe(cuerpo: Record<string, unknown>): boolean {
  return cuerpo.confirmar === undefined ? false : booleanoDe(cuerpo.confirmar, 'confirmar');
}

/* Hashes de los dos ficheros que tocan los topes. Ausente = null: el hash previo
 * de un fichero que no existe es null, no un hash vacío. */
function hashesDe(ruta: string): { config: string | null; extra: string | null } {
  const config = leerFichero(join(ruta, CONFIG));
  const extra = leerFichero(join(ruta, EXTRA));
  return {
    config: config.estado === 'ok' ? config.hash : null,
    extra: extra.estado === 'ok' ? extra.hash : null,
  };
}

function hashesTopesDe(valor: unknown): HashesTopes {
  if (!esObjeto(valor)) throw new ErrorValidacion('hashes debe ser un objeto con config y extra');
  const config = textoRequerido(valor.config, 'hashes.config');
  const extra = valor.extra === null ? null : textoRequerido(valor.extra, 'hashes.extra');
  return { config, extra };
}

function hashesDeTexto(plan: Pick<PlanTopes, 'nuevo'>): HashesTopes {
  return {
    config: hashDe(plan.nuevo.config),
    extra: plan.nuevo.extra === null ? null : hashDe(plan.nuevo.extra),
  };
}

/* Proyecto que existe y tiene Guardián. Un fallo aquí es un 422 para la página. */
function proyectoElegible(deps: DependenciasGuardian, clave: unknown): Proyecto {
  const nombre = textoRequerido(clave, 'clave');
  const proyecto = deps.proyectoPorClave(nombre);
  if (!proyecto) throw new ErrorValidacion(`no existe el proyecto ${nombre}`);
  if (!esElegible(proyecto)) throw new ErrorValidacion(`${nombre} no tiene Guardián: su puerta no es sentinel`);
  return proyecto;
}

/* La plantilla es del tablero, pero se aplica por proyecto según su stack. */
function contextoPlantilla(deps: DependenciasGuardian, clave: string): { plantilla: Plantilla; stacks: string[] } {
  const lectura = leerPlantilla(deps.raizTablero);
  if (lectura.estado === 'ausente') throw new ErrorValidacion(`falta ${RUTA_PLANTILLA}`);
  if (lectura.estado === 'invalida') throw new ErrorValidacion(`plantilla no válida: ${lectura.motivo}`);
  return { plantilla: lectura.plantilla, stacks: lectura.plantilla.stackDeProyecto[clave] ?? [] };
}

function entradasLote(deps: DependenciasGuardian, valor: unknown): EdicionLote[] {
  if (!Array.isArray(valor)) throw new ErrorValidacion('entradas debe ser una lista');
  if (valor.length < 1 || valor.length > MAX_LOTE) {
    throw new ErrorValidacion(`entradas: entre 1 y ${MAX_LOTE} proyectos`);
  }
  const vistas = new Set<string>();
  return valor.map((entrada: unknown) => {
    if (!esObjeto(entrada)) throw new ErrorValidacion('cada entrada debe ser un objeto');
    const proyecto = proyectoElegible(deps, entrada.clave);
    /* [por que] Dos cambios al mismo fichero en un lote se pisarían: se rechaza. */
    if (vistas.has(proyecto.clave)) throw new ErrorValidacion(`${proyecto.clave} aparece dos veces en el lote`);
    vistas.add(proyecto.clave);
    const cambio = validarCambio(entrada.cambio);
    return {
      clave: proyecto.clave,
      raiz: proyecto.ruta,
      hashPrevio: textoRequerido(entrada.hashPrevio, 'hashPrevio'),
      cambio,
      contexto: cambio.aplicarPlantilla ? contextoPlantilla(deps, proyecto.clave) : undefined,
    };
  });
}

function vistaPreviaLote(entradas: EdicionLote[]): ResultadoLote {
  const resultados = entradas.map((e) => ({
    clave: e.clave,
    resultado: calcularEdicion(e.raiz, e.hashPrevio, e.cambio, e.contexto),
  }));
  return { ok: resultados.every(({ resultado }) => resultado.estado === 'ok'), resultados };
}

type ResultadoEdicionBase =
  | { estado: 'ok'; cambia: boolean; diff: BloqueDiff | null; hash: string }
  | { estado: 'conflicto'; motivo: string }
  | { estado: 'error'; motivo: string };

/* Sin el contenido nuevo: la página ve el diff y el hash resultante, no el fichero. */
function resumenEdicion(r: ResultadoEdicionBase): { estado: string; cambia?: boolean; diff?: BloqueDiff | null; hashNuevo?: string; motivo?: string } {
  if (r.estado === 'ok') return { estado: 'ok', cambia: r.cambia, diff: r.diff, hashNuevo: r.hash };
  return { estado: r.estado, motivo: r.motivo };
}

/* [por que] 409 = el fichero cambió desde que la página lo leyó: no se pisa. 422 =
 * la edición no es válida. `escrito` dice si esta respuesta ya escribió. */
function responderEdicion(res: ServerResponse, r: ResultadoEdicion | ResultadoEdicionBase, confirmar: boolean): void {
  if (r.estado === 'conflicto') {
    json(res, 409, resumenEdicion(r));
    return;
  }
  if (r.estado === 'error') {
    json(res, 422, resumenEdicion(r));
    return;
  }
  json(res, 200, { ...resumenEdicion(r), escrito: confirmar && r.cambia });
}
