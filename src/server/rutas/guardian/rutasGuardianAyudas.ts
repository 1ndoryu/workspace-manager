/* Ayudas de validación y de respuesta de las escrituras del Guardián (10AA-2 F11.4).
 * [por que] Separadas de las rutas para que cada módulo quede bajo el límite de líneas;
 * ninguna ayuda toca el disco: solo valida el cuerpo y da forma a la respuesta. */
import type { ServerResponse } from 'node:http';
import { json } from '../../http.js';
import { esObjeto } from '../../../shared/guardas.js';
import { esElegible } from '../../gate/analizador.js';
import type { Proyecto } from '../../../shared/types.js';
import { hashDe, type BloqueDiff } from '../../guardian/escritura.js';
import {
  calcularEdicion,
  ErrorValidacion,
  validarCambio,
  type EdicionLote,
  type Plantilla,
  type ResultadoEdicion,
  type ResultadoLote,
} from '../../guardian/configuracion/politica.js';
import { leerPlantilla, NOMBRE_PLANTILLA } from '../../guardian/configuracion/plantilla.js';
import type { HashesTopes, PlanTopes } from '../../guardian/configuracion/topes.js';
import type { DepsProyecto } from './rutasGuardianTipos.js';

/* [por que] Límite de proyectos por lote: acota el trabajo de una sola petición. */
export const MAX_LOTE = 50;

export function textoRequerido(valor: unknown, nombre: string): string {
  if (typeof valor !== 'string' || valor === '' || valor.length > 512) {
    throw new ErrorValidacion(`${nombre} debe ser texto de 1 a 512 caracteres`);
  }
  return valor;
}

export function booleanoDe(valor: unknown, nombre: string): boolean {
  if (typeof valor !== 'boolean') throw new ErrorValidacion(`${nombre} debe ser true o false`);
  return valor;
}

/* Ausente = vista previa. Solo `confirmar: true` escribe. */
export function confirmarDe(cuerpo: Record<string, unknown>): boolean {
  return cuerpo.confirmar === undefined ? false : booleanoDe(cuerpo.confirmar, 'confirmar');
}

export function hashesTopesDe(valor: unknown): HashesTopes {
  if (!esObjeto(valor)) throw new ErrorValidacion('hashes debe ser un objeto con config y extra');
  const config = textoRequerido(valor.config, 'hashes.config');
  const extra = valor.extra === null ? null : textoRequerido(valor.extra, 'hashes.extra');
  return { config, extra };
}

export function hashesDeTexto(plan: Pick<PlanTopes, 'nuevo'>): HashesTopes {
  return {
    config: hashDe(plan.nuevo.config),
    extra: plan.nuevo.extra === null ? null : hashDe(plan.nuevo.extra),
  };
}

/* Proyecto que existe y tiene Guardián. Un fallo aquí es un 422 para la página. */
export async function proyectoElegible(deps: DepsProyecto, clave: unknown): Promise<Proyecto> {
  const nombre = textoRequerido(clave, 'clave');
  const proyecto = await deps.proyectoPorClave(nombre);
  if (!proyecto) throw new ErrorValidacion(`no existe el proyecto ${nombre}`);
  if (!esElegible(proyecto)) throw new ErrorValidacion(`${nombre} no tiene Guardián: su puerta no es sentinel`);
  return proyecto;
}

/* La plantilla es del tablero, pero se aplica por proyecto según su stack. */
export function contextoPlantilla(
  deps: DepsProyecto,
  clave: string,
): { plantilla: Plantilla; stacks: string[] } {
  const lectura = leerPlantilla(deps.dirConfig);
  if (lectura.estado === 'ausente') throw new ErrorValidacion(`falta ${NOMBRE_PLANTILLA}`);
  if (lectura.estado === 'invalida') throw new ErrorValidacion(`plantilla no válida: ${lectura.motivo}`);
  return { plantilla: lectura.plantilla, stacks: lectura.plantilla.stackDeProyecto[clave] ?? [] };
}

/* Secuencial a propósito: el orden de llegada decide qué entrada es «duplicada». */
export async function entradasLote(deps: DepsProyecto, valor: unknown): Promise<EdicionLote[]> {
  if (!Array.isArray(valor)) throw new ErrorValidacion('entradas debe ser una lista');
  if (valor.length < 1 || valor.length > MAX_LOTE) {
    throw new ErrorValidacion(`entradas: entre 1 y ${MAX_LOTE} proyectos`);
  }
  const vistas = new Set<string>();
  const salida: EdicionLote[] = [];
  for (const entrada of valor as unknown[]) {
    if (!esObjeto(entrada)) throw new ErrorValidacion('cada entrada debe ser un objeto');
    const proyecto = await proyectoElegible(deps, entrada.clave);
    /* [por que] Dos cambios al mismo fichero en un lote se pisarían: se rechaza. */
    if (vistas.has(proyecto.clave)) throw new ErrorValidacion(`${proyecto.clave} aparece dos veces en el lote`);
    vistas.add(proyecto.clave);
    const cambio = validarCambio(entrada.cambio);
    salida.push({
      clave: proyecto.clave,
      raiz: proyecto.ruta,
      hashPrevio: textoRequerido(entrada.hashPrevio, 'hashPrevio'),
      cambio,
      contexto: cambio.aplicarPlantilla ? contextoPlantilla(deps, proyecto.clave) : undefined,
    });
  }
  return salida;
}

export function vistaPreviaLote(entradas: EdicionLote[]): ResultadoLote {
  const resultados = entradas.map((e) => ({
    clave: e.clave,
    resultado: calcularEdicion(e.raiz, e.hashPrevio, e.cambio, e.contexto),
  }));
  return { ok: resultados.every(({ resultado }) => resultado.estado === 'ok'), resultados };
}

export type ResultadoEdicionBase =
  | { estado: 'ok'; cambia: boolean; diff: BloqueDiff | null; hash: string }
  | { estado: 'conflicto'; motivo: string }
  | { estado: 'error'; motivo: string };

/* Sin el contenido nuevo: la página ve el diff y el hash resultante, no el fichero. */
export function resumenEdicion(r: ResultadoEdicionBase): {
  estado: string;
  cambia?: boolean;
  diff?: BloqueDiff | null;
  hashNuevo?: string;
  motivo?: string;
} {
  if (r.estado === 'ok') return { estado: 'ok', cambia: r.cambia, diff: r.diff, hashNuevo: r.hash };
  return { estado: r.estado, motivo: r.motivo };
}

/* [por que] 409 = el fichero cambió desde que la página lo leyó: no se pisa. 422 =
 * la edición no es válida. `escrito` dice si esta respuesta ya escribió. */
export function responderEdicion(
  res: ServerResponse,
  r: ResultadoEdicion | ResultadoEdicionBase,
  confirmar: boolean,
): void {
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