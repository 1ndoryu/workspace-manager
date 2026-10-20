/* Validación pura de la política guard: entradas del usuario y la política leída de
 * sentinel.config.json. Sin E/S: el disco lo lee politica-io.ts. */
import { esObjeto } from '../../../../shared/guardas.js';
import {
  ErrorValidacion,
  LISTAS_GUARD,
  MODOS_GUARD,
  type CambioPolitica,
  type ListaGuard,
  type Listas,
  type ModoGuard,
  type ResultadoValidacion,
} from './politica-tipos.js';

/* Entradas de lista: nombres de script, herramienta o subcomando. Sin espacios
 * ni metacaracteres, porque son nombres y no comandos. */
const PATRON_ENTRADA = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$/u;
const MAX_ENTRADAS = 200;

export function validarEntradas(valores: unknown, nombre: string): string[] {
  if (!Array.isArray(valores)) throw new ErrorValidacion(`${nombre} debe ser una lista`);
  if (valores.length > MAX_ENTRADAS) throw new ErrorValidacion(`${nombre}: máximo ${MAX_ENTRADAS} entradas`);
  const vistos = new Set<string>();
  for (const v of valores) {
    if (typeof v !== 'string' || !PATRON_ENTRADA.test(v)) {
      throw new ErrorValidacion(`${nombre}: entrada no válida ${JSON.stringify(v)} (solo letras, números y ._:@/-)`);
    }
    vistos.add(v);
  }
  return [...vistos];
}

export function validarCambio(entrada: unknown): CambioPolitica {
  if (!esObjeto(entrada)) throw new ErrorValidacion('el cambio debe ser un objeto');
  const cambio: CambioPolitica = {};
  if (entrada.modo !== undefined) {
    if (!MODOS_GUARD.includes(entrada.modo as ModoGuard)) throw new ErrorValidacion(`modo no válido: ${String(entrada.modo)}`);
    cambio.modo = entrada.modo as ModoGuard;
  }
  if (entrada.listas !== undefined) {
    if (!esObjeto(entrada.listas)) throw new ErrorValidacion('listas debe ser un objeto');
    cambio.listas = {};
    for (const [clave, valor] of Object.entries(entrada.listas)) {
      if (!LISTAS_GUARD.includes(clave as ListaGuard)) throw new ErrorValidacion(`lista desconocida: ${clave}`);
      cambio.listas[clave as ListaGuard] = validarEntradas(valor, clave);
    }
  }
  if (entrada.aplicarPlantilla !== undefined) {
    if (typeof entrada.aplicarPlantilla !== 'boolean') throw new ErrorValidacion('aplicarPlantilla debe ser booleano');
    cambio.aplicarPlantilla = entrada.aplicarPlantilla;
  }
  return cambio;
}

/* Espejo de readV2GuardPolicy (glory-sentinel src/core/guardCommand.ts): mismas
 * reglas, para que el tablero no muestre como válido lo que Sentinel rechaza. */
export function validarPolitica(json: unknown): ResultadoValidacion {
  if (!esObjeto(json)) return { ok: false, motivo: 'la raíz no es un objeto JSON' };
  if (json.schemaVersion !== 2) {
    return { ok: false, motivo: `schemaVersion ${String(json.schemaVersion)}: Sentinel usa los defaults; hay que migrarla a mano` };
  }
  if (!MODOS_GUARD.includes(json.mode as ModoGuard)) return { ok: false, motivo: `mode no válido: ${String(json.mode)}` };
  const guard = json.guard;
  const dc = esObjeto(guard) ? guard.directCommands : undefined;
  if (!esObjeto(dc)) return { ok: false, motivo: 'falta guard.directCommands' };
  const listas = {} as Listas;
  for (const clave of LISTAS_GUARD) {
    const valor = dc[clave];
    if (!Array.isArray(valor) || !valor.every((x) => typeof x === 'string')) {
      return { ok: false, motivo: `guard.directCommands.${clave} debe ser una lista de texto` };
    }
    listas[clave] = valor as string[];
  }
  return { ok: true, modo: json.mode as ModoGuard, listas };
}
