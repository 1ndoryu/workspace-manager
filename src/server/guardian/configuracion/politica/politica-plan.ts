/* Plan de edición y plantilla de la política guard. Calcula el texto nuevo y las
 * diferencias sin escribir nada.
 * [por que] Reescribir el JSON entero lo reformatea y ensucia el diff. Por eso
 * solo se toca el texto de `mode` y de los arrays que cambian (inline o
 * multilínea, como estén), y antes de escribir se comprueba con deepStrictEqual
 * que el resultado es exactamente la política prevista. */
import assert from 'node:assert/strict';
import { diffLineas, eolDe, type Eol } from '../../escritura.js';
import {
  ErrorValidacion,
  LISTAS_GUARD,
  type CambioPolitica,
  type ListaGuard,
  type Listas,
  type ModoGuard,
  type PlanEdicion,
  type Plantilla,
} from './politica-tipos.js';
import { validarPolitica } from './politica-validar.js';

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
