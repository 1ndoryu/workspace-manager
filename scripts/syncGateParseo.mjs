/* Parseo PURO del schema de sync-gate: el config.d.ts del runtime (texto -> arbol de formas)
 * y la curacion ESQUEMA_SENTINEL (objeto -> arbol de formas). Sin disco: la lectura del
 * archivo esta en syncGateLectura.mjs. */

import { ESQUEMA_SENTINEL } from '../src/shared/gate/catalogo/sentinel.js';

/* ------------------------------------------------------------------ *
 *  Parsing del config.d.ts (interface SentinelConfigFile del runtime)
 * ------------------------------------------------------------------ */

export function extraerInterface(texto, nombre) {
  const re = new RegExp(`(?:export\\s+)?interface\\s+${nombre}\\b`);
  const m = re.exec(texto);
  if (!m) return null;
  const ini = texto.indexOf('{', m.index);
  return { ini, fin: cerrarLlaves(texto, ini), bloque: null };
}

function cerrarLlaves(texto, ini) {
  let depth = 0;
  for (let i = ini; i < texto.length; i++) {
    if (texto[i] === '{') depth++;
    else if (texto[i] === '}') {
      if (--depth === 0) return i;
    }
  }
  return -1;
}

/* Divide el cuerpo de una interface en declaraciones de membro, respetando
 * llaves/corchetes/genericos. Los genericos de Record<...> no llevan ';'
 * interno pero si `->` sin `;`; aqui solo importan `{`-`}` y el `;` de cierre. */
function dividirMiembros(cuerpo) {
  const out = [];
  let depth = 0;
  let actual = '';
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ';' && depth === 0) {
      const t = actual.trim();
      if (t) out.push(t);
      actual = '';
      continue;
    }
    actual += c;
  }
  const t = actual.trim();
  if (t) out.push(t);
  return out;
}

/* Devuelve { nombre, opcional, tipo } de una declaracion `nombre?: tipo`. */
function parseDeclaracion(miembro) {
  const iCol = miembro.indexOf(':');
  const nombre = miembro.slice(0, iCol).trim();
  const opcional = nombre.endsWith('?');
  const dtsTipo = miembro.slice(iCol + 1).trim();
  return { nombre: opcional ? nombre.slice(0, -1) : nombre, opcional, tipo: dtsTipo };
}

/* Normaliza un tipo del .d.ts a { forma, hijos? } para compararlo con la
 * curacion. formas: 'string'|'number'|'boolean'|'string[]'|'objeto'|'mapa'|'recursivo'. */
export function formaDts(tipo, parsearObjeto) {
  const t = tipo.trim();
  if (/^Record\s*</.test(t)) {
    const izq = t.indexOf('<');
    const der = t.lastIndexOf('>');
    const valor = (t.slice(izq + 1, der).match(/,/) ? t.slice(t.indexOf(',', izq) + 1, der) : t.slice(izq + 1, der)).trim();
    const vf = formaDts(valor, parsearObjeto);
    return { forma: 'mapa', valor: vf.forma };
  }
  if (/SentinelConfigFile/.test(t)) return { forma: 'recursivo' };
  if (t.startsWith('{')) {
    const fin = cerrarLlaves(t, 0);
    return parsearObjeto(t.slice(1, fin), formaDts);
  }
  if (t.endsWith('[]')) return { forma: 'string[]' };
  if (t === 'string') return { forma: 'string' };
  if (t === 'number') return { forma: 'number' };
  if (t === 'boolean') return { forma: 'boolean' };
  return { forma: t }; // tipo desconocido: se reporta en bruto
}

export function parsearObjeto(cuerpo, refForma) {
  const hijos = {};
  for (const m of dividirMiembros(cuerpo)) {
    const { nombre, tipo } = parseDeclaracion(m);
    hijos[nombre] = refForma(tipo, parsearObjeto);
  }
  return { forma: 'objeto', hijos };
}

/* Quita comentarios de bloque/linea del codigo fuente del .d.ts. */
export function limpiarComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])-{2}[^\n]*/g, '$1');
}
/* ------------------------------------------------------------------ *
 *  Arbol de opciones de la curacion (ESQUEMA_SENTINEL)
 * ------------------------------------------------------------------ */

export function formaCuracion(nodo, vistos) {
  if (!nodo || typeof nodo !== 'object') return { forma: '?' };
  if ('tipo' in nodo) {
    switch (nodo.tipo) {
      case 'string': case 'enum': return { forma: 'string' };
      case 'number': return { forma: 'number' };
      case 'boolean': return { forma: 'boolean' };
      case 'stringArray': return { forma: 'string[]' };
      default: return { forma: nodo.tipo };
    }
  }
  if ('objeto' in nodo) {
    if (nodo.objeto.objeto === undefined && !Object.keys(nodo.objeto).length) return { forma: 'objeto', hijos: {} };
    return formaCuracionObjeto(nodo.objeto.objeto ?? nodo.objeto, vistos);
  }
  if ('mapa' in nodo) {
    const vf = formaCuracion(nodo.mapa, vistos);
    return { forma: 'mapa', valor: vf.forma };
  }
  if ('mapaCatalogo' in nodo) return { forma: 'mapa', valor: 'objeto' };
  if ('listaDe' in nodo) return { forma: 'string[]' };
  return { forma: '?' };
}

function formaCuracionObjeto(hijos, vistos) {
  const res = { forma: 'objeto', hijos: {} };
  if (vistos.has(hijos)) return { forma: 'recursivo' };
  vistos.add(hijos);
  for (const [k, v] of Object.entries(hijos || {})) {
    res.hijos[k] = formaCuracion(v, vistos);
  }
  vistos.delete(hijos);
  return res;
}

export function leerEsquemaCuracion() {
  const vistos = new Set();
  const esquema = ESQUEMA_SENTINEL();
  return formaCuracion(esquema, vistos).hijos;
}
