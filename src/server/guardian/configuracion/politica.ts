/* Política guard por proyecto (F11.4): lectura validada con el mismo esquema que
 * `readV2GuardPolicy` de Sentinel y edición de `sentinel.config.json`.
 * [por que] Reescribir el JSON entero lo reformatea y ensucia el diff. Por eso
 * solo se toca el texto de `mode` y de los arrays que cambian (inline o
 * multilínea, como estén), y antes de escribir se comprueba con deepStrictEqual
 * que el resultado es exactamente la política prevista. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { diffLineas, eolDe, escribirAtomico, hashDe, leerFichero, type BloqueDiff, type Eol } from '../escritura.js';
import { esObjeto } from '../../../shared/guardas.js';

export const MODOS_GUARD = ['enforce', 'observe', 'pass-through'] as const;
export type ModoGuard = (typeof MODOS_GUARD)[number];

export const LISTAS_GUARD = ['npmScripts', 'npxTools', 'cargoSubcommands', 'tools'] as const;
export type ListaGuard = (typeof LISTAS_GUARD)[number];
export type Listas = Record<ListaGuard, string[]>;

/* Git, python y pip no tienen shim (D8 a): listarlos no intercepta nada. */
export const SIN_SHIM = ['git', 'python', 'pip'] as const;

/* Entradas de lista: nombres de script, herramienta o subcomando. Sin espacios
 * ni metacaracteres, porque son nombres y no comandos. */
const PATRON_ENTRADA = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$/u;
const MAX_ENTRADAS = 200;

/* Error de entrada del usuario: las rutas lo convierten en 422, no en 500. */
export class ErrorValidacion extends Error {}

export interface Plantilla {
  schemaVersion: 1;
  descripcion?: string;
  quitarDeTools: string[];
  plantillas: Record<string, Partial<Listas>>;
  stackDeProyecto: Record<string, string[]>;
}

export interface CambioPolitica {
  modo?: ModoGuard;
  listas?: Partial<Listas>;
  /* Aplica la plantilla de los stacks del proyecto encima de las listas. */
  aplicarPlantilla?: boolean;
}

export type LecturaPolitica =
  | { estado: 'ausente' }
  | { estado: 'invalida'; motivo: string; hash: string | null }
  | { estado: 'ok'; modo: ModoGuard; listas: Listas; contenido: string; hash: string };

export type ResultadoValidacion =
  | { ok: true; modo: ModoGuard; listas: Listas }
  | { ok: false; motivo: string };

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

/* Lee y valida <raiz>/sentinel.config.json. Symlink o carpeta → inválida. */
export function leerPolitica(raiz: string): LecturaPolitica {
  const lectura = leerFichero(join(raiz, 'sentinel.config.json'));
  if (lectura.estado === 'ausente') return { estado: 'ausente' };
  if (lectura.estado === 'invalido') return { estado: 'invalida', motivo: lectura.motivo, hash: null };
  let json: unknown;
  try {
    json = JSON.parse(lectura.contenido);
  } catch {
    return { estado: 'invalida', motivo: 'JSON no válido', hash: lectura.hash };
  }
  const v = validarPolitica(json);
  if (!v.ok) return { estado: 'invalida', motivo: v.motivo, hash: lectura.hash };
  return { estado: 'ok', modo: v.modo, listas: v.listas, contenido: lectura.contenido, hash: lectura.hash };
}

/* Rango de `"directCommands": { ... }` dentro del texto, por conteo de llaves. */
function bloqueDirectCommands(texto: string): { inicio: number; fin: number } {
  const marca = '"directCommands": {';
  const inicio = texto.indexOf(marca);
  if (inicio < 0 || texto.indexOf(marca, inicio + 1) >= 0) {
    throw new ErrorValidacion('directCommands no existe o no es único');
  }
  const abre = inicio + marca.length - 1;
  let profundidad = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '{') profundidad++;
    else if (texto[i] === '}' && --profundidad === 0) return { inicio: abre, fin: i + 1 };
  }
  throw new ErrorValidacion('directCommands sin llave de cierre');
}

/* Reemplaza `"clave": [...]` dentro del bloque conservando su estilo: inline
 * si era inline, multilínea si era multilínea, `[]` si queda vacío. */
function reescribirArray(bloque: string, clave: string, valores: string[], eol: Eol): string {
  const re = new RegExp(`^( *)"${clave}": \\[([^\\]]*)\\]`, 'mu');
  const m = re.exec(bloque);
  if (!m) throw new ErrorValidacion(`la política no declara ${clave}`);
  const sangria = m[1];
  let texto: string;
  if (valores.length === 0) texto = '[]';
  else if (m[2].includes('\n')) {
    texto = `[${eol}${valores.map((v) => `${sangria}  ${JSON.stringify(v)}`).join(`,${eol}`)}${eol}${sangria}]`;
  } else texto = `[${valores.map((v) => JSON.stringify(v)).join(', ')}]`;
  return bloque.slice(0, m.index) + `${sangria}"${clave}": ${texto}` + bloque.slice(m.index + m[0].length);
}

export interface PlanEdicion {
  nuevo: string;
  cambia: boolean;
  diff: BloqueDiff | null;
}

/* Calcula el texto nuevo de la política sin escribirlo. Solo cambian `mode` y
 * las listas que difieren; el resultado se verifica contra la política prevista. */
export function planificarCambio(contenido: string, cambio: CambioPolitica): PlanEdicion {
  const original = JSON.parse(contenido) as Record<string, unknown> & {
    mode: ModoGuard;
    guard: { directCommands: Record<ListaGuard, string[]> };
  };
  const valida = validarPolitica(original);
  if (!valida.ok) throw new ErrorValidacion(valida.motivo);
  const eol = eolDe(contenido);
  let texto = contenido;
  if (cambio.modo && cambio.modo !== valida.modo) {
    const re = /^( {2})"mode": "[^"]*"/mu;
    if (!re.test(texto)) throw new ErrorValidacion('no encuentro "mode" en la raíz de sentinel.config.json');
    texto = texto.replace(re, `$1"mode": "${cambio.modo}"`);
  }
  const cambiadas = LISTAS_GUARD.filter((k) => {
    const nueva = cambio.listas?.[k];
    return nueva !== undefined && JSON.stringify(nueva) !== JSON.stringify(valida.listas[k]);
  });
  if (cambiadas.length > 0) {
    const { inicio, fin } = bloqueDirectCommands(texto);
    let bloque = texto.slice(inicio, fin);
    for (const k of cambiadas) bloque = reescribirArray(bloque, k, cambio.listas?.[k] ?? [], eol);
    texto = texto.slice(0, inicio) + bloque + texto.slice(fin);
  }
  const esperado = structuredClone(original);
  if (cambio.modo) esperado.mode = cambio.modo;
  for (const k of cambiadas) esperado.guard.directCommands[k] = cambio.listas?.[k] ?? [];
  assert.deepStrictEqual(JSON.parse(texto), esperado, 'la edición no produce la política prevista');
  return { nuevo: texto, cambia: texto !== contenido, diff: diffLineas(contenido, texto) };
}

/* Unión sin duplicados que conserva el orden de la lista actual. */
function unir(actual: string[], añadir: string[] = []): string[] {
  return [...new Set([...actual, ...añadir])];
}

/* Aplica la plantilla de los stacks del proyecto: quita de tools lo que la
 * plantilla prohíbe y añade la unión de cada stack. Nunca quita nada más. */
export function aplicarPlantilla(listas: Listas, stacks: string[], plantilla: Plantilla): Listas {
  const salida: Listas = {
    npmScripts: [...listas.npmScripts],
    npxTools: [...listas.npxTools],
    cargoSubcommands: [...listas.cargoSubcommands],
    tools: listas.tools.filter((t) => !plantilla.quitarDeTools.includes(t)),
  };
  for (const stack of stacks) {
    const p = plantilla.plantillas[stack];
    if (!p) continue;
    for (const k of LISTAS_GUARD) salida[k] = unir(salida[k], p[k]);
  }
  return salida;
}

/* Lo que la plantilla espera que tenga el proyecto y no tiene, y las entradas
 * que la plantilla quita y han vuelto a aparecer (D8 a). */
export function diferenciasPlantilla(
  listas: Listas,
  stacks: string[],
  plantilla: Plantilla,
): { faltan: string[]; reaparecen: string[] } {
  const esperadas = aplicarPlantilla(listas, stacks, plantilla);
  const faltan: string[] = [];
  for (const k of LISTAS_GUARD) {
    for (const v of esperadas[k]) if (!listas[k].includes(v)) faltan.push(`${k}:${v}`);
  }
  const reaparecen = listas.tools.filter((t) => plantilla.quitarDeTools.includes(t)).map((t) => `tools:${t}`);
  return { faltan, reaparecen };
}

export interface EntradaEdicion {
  clave: string;
  hashPrevio: string;
  cambio: CambioPolitica;
}

export type ResultadoEdicion =
  | { estado: 'ok'; cambia: boolean; diff: BloqueDiff | null; hash: string; plan: PlanEdicion; lectura: Extract<LecturaPolitica, { estado: 'ok' }> }
  | { estado: 'conflicto'; motivo: string }
  | { estado: 'error'; motivo: string };

/* Calcula la edición de un proyecto sin escribir. Comprueba el hash previo:
 * si el fichero cambió desde que la página lo leyó, no se pisa (409). */
export function calcularEdicion(
  raiz: string,
  hashPrevio: string,
  cambio: CambioPolitica,
  contexto?: { plantilla: Plantilla; stacks: string[] },
): ResultadoEdicion {
  const lectura = leerPolitica(raiz);
  if (lectura.estado !== 'ok') {
    return { estado: 'error', motivo: lectura.estado === 'ausente' ? 'el proyecto no tiene sentinel.config.json' : lectura.motivo };
  }
  if (lectura.hash !== hashPrevio) {
    return { estado: 'conflicto', motivo: 'sentinel.config.json cambió desde que se leyó; recarga la página' };
  }
  let listas: Listas = { ...lectura.listas };
  for (const k of LISTAS_GUARD) if (cambio.listas?.[k]) listas[k] = cambio.listas[k] ?? [];
  if (cambio.aplicarPlantilla) {
    if (!contexto) throw new ErrorValidacion('falta la plantilla para aplicarla');
    listas = aplicarPlantilla(listas, contexto.stacks, contexto.plantilla);
  }
  const plan = planificarCambio(lectura.contenido, { modo: cambio.modo, listas });
  return { estado: 'ok', cambia: plan.cambia, diff: plan.diff, hash: hashDe(plan.nuevo), plan, lectura };
}

/* Relee justo antes de escribir: si el fichero cambió desde el cálculo, no se
 * pisa. [por que] Cierra la ventana lectura→escritura lo mejor posible: un
 * editor o un agente pueden escribir en cualquier momento, y sin bloqueo de
 * ficheros no hay garantía total, solo comprobación. */
function reverificar(raiz: string, hashCalculado: string): string | null {
  const ahora = leerPolitica(raiz);
  if (ahora.estado !== 'ok' || ahora.hash !== hashCalculado) {
    return 'sentinel.config.json cambió mientras se calculaba la edición; recarga la página';
  }
  return null;
}

/* Escribe la edición de un proyecto (atómico). Sin cambios, no toca el fichero. */
export function guardarEdicion(
  raiz: string,
  hashPrevio: string,
  cambio: CambioPolitica,
  contexto?: { plantilla: Plantilla; stacks: string[] },
): ResultadoEdicion {
  const r = calcularEdicion(raiz, hashPrevio, cambio, contexto);
  if (r.estado !== 'ok' || !r.cambia) return r;
  const motivo = reverificar(raiz, r.lectura.hash);
  if (motivo) return { estado: 'conflicto', motivo };
  escribirAtomico(join(raiz, 'sentinel.config.json'), r.plan.nuevo);
  return r;
}

export interface EdicionLote {
  clave: string;
  raiz: string;
  hashPrevio: string;
  cambio: CambioPolitica;
  contexto?: { plantilla: Plantilla; stacks: string[] };
}

export interface ResultadoLote {
  ok: boolean;
  resultados: Array<{ clave: string; resultado: ResultadoEdicion }>;
  /* Solo si una escritura falló a mitad: qué se revirtió y qué no pudo revertirse. */
  revertidas?: string[];
  sinRevertir?: string[];
  error?: string;
}

/* Lote de ediciones: calcula todas primero y, si alguna no es válida, no escribe
 * nada. Si una escritura falla a mitad, restaura las ya escritas con su contenido
 * original. `escribir` se inyecta solo para probar el rollback. */
export function guardarLote(
  entradas: EdicionLote[],
  escribir: (ruta: string, contenido: string) => void = escribirAtomico,
): ResultadoLote {
  const calculados = entradas.map((e) => ({
    clave: e.clave,
    raiz: e.raiz,
    resultado: calcularEdicion(e.raiz, e.hashPrevio, e.cambio, e.contexto),
  }));
  const resultados = calculados.map(({ clave, resultado }) => ({ clave, resultado }));
  if (calculados.some(({ resultado }) => resultado.estado !== 'ok')) return { ok: false, resultados };

  const escritas: Array<{ clave: string; ruta: string; original: string }> = [];
  try {
    for (const { clave, raiz, resultado } of calculados) {
      if (resultado.estado !== 'ok' || !resultado.cambia) continue;
      const motivo = reverificar(raiz, resultado.lectura.hash);
      if (motivo) throw new Error(`${clave}: ${motivo}`);
      const ruta = join(raiz, 'sentinel.config.json');
      escribir(ruta, resultado.plan.nuevo);
      escritas.push({ clave, ruta, original: resultado.lectura.contenido });
    }
  } catch (err) {
    const revertidas: string[] = [];
    const sinRevertir: string[] = [];
    for (const e of escritas.reverse()) {
      try {
        escribir(e.ruta, e.original);
        revertidas.push(e.clave);
      } catch {
        sinRevertir.push(e.clave);
      }
    }
    return { ok: false, resultados, revertidas, sinRevertir, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, resultados };
}
