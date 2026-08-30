#!/usr/bin/env node
/* sync-gate-schema: detecta desalineacion entre el schema de config del runtime
 * sentinel instalado y la curacion actual (ESQUEMA_SENTINEL en shared/gate).
 *
 * [por que] El schema de config NO es derivable en runtime (config.d.ts es
 * compile-time, ver PLAN-gate-dinamico.md §1). Lo unico que garantiza que la
 * curacion siga al dia es COMPARARLA contra la fuente canónica: el
 * `config.d.ts` de la version instalada. Este script es la guarda: si el
 * runtime gana/quita campos o cambia su forma, lo reporta y sale != 0 para
 * poder colgarlo de CI/guard. NUNCA modifica la curacion ni el JSON de ningun
 * proyecto: solo reporta; el alineado manual queda documentado.
 *
 * Uso:  pnpm sync:gate            (corre contra la version instalada)
 *       pnpm sync:gate --json
 *       pnpm sync:gate --dts <archivo>  (comparar contra un .d.ts especifico;
 *                                        util en CI/tests; ignora la version
 *                                        instalada)
 *
 * Exit codes:
 *   0  alineado (o solo 'sobrantes' de curacion: avanza, no rompe)
 *   1  desalineacion : FALTAN campos del runtime que la curacion no cubre,
 *      o CAMBIO de forma/ tipo en uno ya cubierto
 *   2  variacion de version del runtime respecto de la curacion */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_VERSIONS, versionRuntime, VERSION_CURACION_SENTINEL } from '../src/server/gate/proveedor.js';
import { ESQUEMA_SENTINEL } from '../src/shared/gate/sentinel.js';

/* ------------------------------------------------------------------ *
 *  Parsing del config.d.ts (interface SentinelConfigFile del runtime)
 * ------------------------------------------------------------------ */

function extraerInterface(texto, nombre) {
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
function formaDts(tipo, parsearObjeto) {
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

function parsearObjeto(cuerpo, refForma) {
  const hijos = {};
  for (const m of dividirMiembros(cuerpo)) {
    const { nombre, tipo } = parseDeclaracion(m);
    hijos[nombre] = refForma(tipo, parsearObjeto);
  }
  return { forma: 'objeto', hijos };
}

/* Quita comentarios de bloque/linea del codigo fuente del .d.ts. */
function limpiarComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])-{2}[^\n]*/g, '$1');
}

function leerEsquemaRuntime(dtsPath, nombre) {
  const texto = limpiarComentarios(readFileSync(dtsPath, 'utf8'));
  const rango = extraerInterface(texto, nombre);
  if (!rango) return null;
  const cuerpo = texto.slice(rango.ini + 1, rango.fin);
  return parsearObjeto(cuerpo, formaDts).hijos;
}

/* ------------------------------------------------------------------ *
 *  Arbol de opciones de la curacion (ESQUEMA_SENTINEL)
 * ------------------------------------------------------------------ */

function formaCuracion(nodo, vistos) {
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

function leerEsquemaCuracion() {
  const vistos = new Set();
  const esquema = ESQUEMA_SENTINEL();
  return formaCuracion(esquema, vistos).hijos;
}

/* ------------------------------------------------------------------ *
 *  Comparacion por ruta (presencia + forma)
 * ------------------------------------------------------------------ */

function gruposCompatibles(a, b) {
  const scalar = new Set(['string', 'number', 'boolean']);
  if (scalar.has(a) && scalar.has(b)) return true;
  return a === b;
}

function comparar(rt, cu, ruta, out) {
  /* Si la curacion modela el nivel como mapa/mapaCatalogo, cubre cualquier
   * clave (p.ej. analyzers, rules, directCommands): no se comparan llaves
   * hijas y no hay FALTAN por claves del runtime. Sigue siendo compatible si
   * el runtime expone un objeto o un Record en ese punto. */
  if (cu.forma === 'mapa' || cu.forma === 'recursivo') return;
  /* Objetos: comparar presencia y forma de las claves hijas. */
  if (rt.forma === 'objeto' && cu.forma === 'objeto') {
    for (const k of Object.keys(rt.hijos ?? {})) {
      const rutaK = ruta ? `${ruta}.${k}` : k;
      const hijoRt = rt.hijos[k];
      const hijoCu = cu.hijos?.[k];
      /* Un mapa del runtime (Record<...>) es mas general que un objeto de la
       * curacion: no se compara recursivamente. */
      if (hijoRt.forma === 'mapa') continue;
      if (hijoCu) comparar(hijoRt, hijoCu, rutaK, out);
      else out.push({ tipo: 'falta', ruta: rutaK, rt: hijoRt.forma });
    }
    for (const k of Object.keys(cu.hijos ?? {})) {
      const rutaK = ruta ? `${ruta}.${k}` : k;
      if (!(k in (rt.hijos ?? {}))) out.push({ tipo: 'sobra', ruta: rutaK, cu: cu.hijos[k].forma });
    }
    return;
  }
  /* Comparar forma de las hojas / ramas no-objeto. */
  if (!gruposCompatibles(rt.forma, cu.forma)) {
    out.push({ tipo: 'cambio', ruta, rt: rt.forma, cu: cu.forma });
  }
}

function compararEsquemas(rt, cu) {
  const out = [];
  comparar({ forma: 'objeto', hijos: rt }, { forma: 'objeto', hijos: cu }, '', out);
  return out;
}

/* ------------------------------------------------------------------ *
 *  Reporte y salida
 * ------------------------------------------------------------------ */

function main() {
  const useJson = process.argv.includes('--json');
  const idxDts = process.argv.indexOf('--dts');
  const dtsArg = idxDts >= 0 ? process.argv[idxDts + 1] : null;
  const version = dtsArg ? '—' : versionRuntime();
  const dtsPath = dtsArg || (version ? join(RAIZ_VERSIONS, version, 'out', 'core', 'config.d.ts') : null);

  const reporte = { versionRuntime: version, versionCuracion: VERSION_CURACION_SENTINEL, problemas: [] };

  if (!dtsPath || !existsSync(dtsPath)) {
    reporte.error = `no hay config.d.ts del runtime (version ${version ?? 'ninguna'}). Esperaba: ${dtsPath}`;
    if (useJson) {
      console.log(JSON.stringify(reporte, null, 2));
      return 1;
    }
    console.error(`no hay config.d.ts del runtime (${version ?? 'ninguna'}).`);
    console.error(`ruta esperada: ${dtsPath}`);
    return 1;
  }

  const rt = leerEsquemaRuntime(dtsPath, 'SentinelConfigFile');
  const cu = leerEsquemaCuracion();
  if (!rt) return 1;

  const problemas = compararEsquemas(rt, cu);

  if (version !== VERSION_CURACION_SENTINEL) {
    problemas.unshift({
      tipo: 'version',
      ruta: '',
      rt: version,
      cu: VERSION_CURACION_SENTINEL,
    });
  }

  reporte.problemas = problemas;

  if (useJson) {
    console.log(JSON.stringify(reporte, null, 2));
  } else {
    console.log(`runtime sentinel  : ${version ?? '—'}`);
    console.log(`curacion sentinel : ${VERSION_CURACION_SENTINEL}`);
    console.log('');
    if (!problemas.length) {
      console.log('OK: la curacion ESQUEMA_SENTINEL esta alineada con el runtime.');
      return 0;
    }
    for (const p of problemas) {
      if (p.tipo === 'version') console.log(`AVISO version: curada contra ${p.cu}, runtime ${p.rt} -> ejecutar sync/realinear`);
      else if (p.tipo === 'falta') console.log(`FALTA  ${p.ruta || '<raiz>'}  (runtime: ${p.rt}) -> la curacion no lo cubre`);
      else if (p.tipo === 'sobra') console.log(`SOBRA  ${p.ruta}  (curacion: ${p.cu}) -> campo de mas en la curacion`);
      else if (p.tipo === 'cambio') console.log(`CAMBIO ${p.ruta}  (runtime: ${p.rt} / curacion: ${p.cu}) -> forma o tipo distinto`);
    }
  }

  const criticos = problemas.some((p) => p.tipo === 'falta' || p.tipo === 'cambio');
  const versionDesalineada = problemas.some((p) => p.tipo === 'version');
  if (criticos) return 1;
  if (versionDesalineada) return 2;
  return 0;
}

process.exit(main());