/* Router y lecturas de /api/guardian/* (10AA-2 F11.4): la pestaña de primer nivel que
 * controla la política, los topes, la plantilla y el mantenimiento del guard de los
 * proyectos elegibles. [por que] Sustituye a /api/guard/* (D6: la interfaz anterior
 * se retira). Las lecturas solo leen ficheros; las escrituras viven en
 * rutasGuardianEscritura.ts. Devuelve true si atendió la ruta, false si no es suya. */
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../../http.js';
import { dirConfigPrivada } from '../../../shared/rutas.js';
import { snapshotArea } from '../../snapshot.js';
import { esElegible } from '../../gate/analizador.js';
import type { Proyecto } from '../../../shared/types.js';
import { leerGuardProyecto } from '../../guardian/configuracion/lector.js';
import {
  diferenciasPlantilla,
  ErrorValidacion,
  leerPolitica,
  SIN_SHIM,
  type Listas,
  type ModoGuard,
} from '../../guardian/configuracion/politica.js';
import { leerPlantilla, type LecturaPlantilla } from '../../guardian/configuracion/plantilla.js';
import { CONFIG, EXTRA } from '../../guardian/configuracion/topes.js';
import { leerFichero } from '../../guardian/escritura.js';
import { leerActividad, type FiltrosActividad } from '../../guardian/operacion/actividad.js';
import { probarComando } from '../../guardian/operacion/probar.js';
import { ejecutarMantenimiento } from '../../guardian/operacion/mantenimiento.js';
import type { Contexto, DependenciasGuardian, Manejador } from './rutasGuardianTipos.js';
import {
  editarLote,
  editarPlantilla,
  editarPolitica,
  editarTopes,
  mantenimientoRuta,
  probarRuta,
} from './rutasGuardianEscritura.js';

const proyectosActuales = async (): Promise<Proyecto[]> => (await snapshotArea(false)).snapshot.proyectos;

export const dependenciasReales: DependenciasGuardian = {
  dirConfig: dirConfigPrivada(),
  proyectos: proyectosActuales,
  proyectoPorClave: async (clave) => (await proyectosActuales()).find((p) => p.clave === clave) ?? null,
  leerActividad,
  probarComando,
  ejecutarMantenimiento,
};

/* [por que] Clave «verbo ruta»: una ruta con otro verbo responde 405 y una ruta
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
  | { estado: 'ok'; listas: Listas; modo: ModoGuard }
  | { estado: 'ausente' }
  | { estado: 'invalida'; motivo: string };

function estadoListasDe(ruta: string): EstadoListas {
  const lectura = leerPolitica(ruta);
  if (lectura.estado === 'ok') return { estado: 'ok', listas: lectura.listas, modo: lectura.modo };
  if (lectura.estado === 'ausente') return { estado: 'ausente' };
  return { estado: 'invalida', motivo: lectura.motivo };
}

function estadoElegible(clave: string, ruta: string) {
  return { elegible: true as const, ...leerGuardProyecto(clave, ruta), listas: estadoListasDe(ruta) };
}

async function estadoProyecto({ res, url, deps }: Contexto): Promise<void> {
  const clave = url.searchParams.get('clave') ?? '';
  const proyecto = await deps.proyectoPorClave(clave);
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

/* [por que] Diferencias de un proyecto con la plantilla de sus stacks. `sin-politica`
 * si sus listas no son legibles: no se comparan listas inventadas. */
export type DiferenciasPlantilla =
  | { estado: 'ok'; stacks: string[]; faltan: string[]; reaparecen: string[] }
  | { estado: 'sin-plantilla' }
  | { estado: 'sin-politica' };

function diferenciasDe(clave: string, listas: EstadoListas, plantilla: LecturaPlantilla): DiferenciasPlantilla {
  if (plantilla.estado !== 'ok') return { estado: 'sin-plantilla' };
  if (listas.estado !== 'ok') return { estado: 'sin-politica' };
  const stacks = plantilla.plantilla.stackDeProyecto[clave] ?? [];
  return { estado: 'ok', stacks, ...diferenciasPlantilla(listas.listas, stacks, plantilla.plantilla) };
}

/* [por que] Barrido agregado sin hashes: son dos lecturas más por proyecto y solo
 * hacen falta al editar, cuando la página pide estadoProyecto. La matriz de
 * «Comandos» necesita además `sinShim` y las diferencias con la plantilla; la
 * plantilla se lee una sola vez para todo el barrido. */
async function estadoArea({ res, deps }: Contexto): Promise<void> {
  const proyectos = await deps.proyectos();
  const plantilla = leerPlantilla(deps.dirConfig);
  json(res, 200, {
    total: proyectos.length,
    sinShim: [...SIN_SHIM],
    proyectos: proyectos.map((p) => {
      if (!esElegible(p)) return { clave: p.clave, elegible: false as const };
      const estado = estadoElegible(p.clave, p.ruta);
      return { ...estado, diferencias: diferenciasDe(p.clave, estado.listas, plantilla) };
    }),
  });
}

async function verPlantilla({ res, deps }: Contexto): Promise<void> {
  json(res, 200, leerPlantilla(deps.dirConfig));
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
