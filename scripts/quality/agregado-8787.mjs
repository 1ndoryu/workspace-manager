#!/usr/bin/env node
/**
 * 318A-7V13C — Mapeo del agregado vivo 8787 (cierre de auditoría).
 *
 * La auditoría de cierre señaló que el agregado tiene DOS shapes y los sweeps
 * manuales (V9..V13) los reconciliaban a mano, con riesgo de lectura equivocada
 * (p. ej. el campo `total` del GET es el NÚMERO DE PROYECTOS, no la suma de
 * hallazgos). Este script consume ambos endpoints con el mismo mapeo y reporta
 * una tabla única por proyecto:
 *
 *   node scripts/quality/agregado-8787.mjs [--solo-mision] [--json]
 *
 * Endpoints (server 8787, proyecto workspace-manager):
 *   GET  /api/gate/analisis        → { total: <nº proyectos>, analisis: { clave: entrada } }
 *   POST /api/gate/analizar-todo   → { escaneadoEn, snapshot, proyectos: [entrada] }
 * donde `entrada` = { clave, version, fuente, estado, analizadoEn, resumen,
 * hallazgos[], varsense }. El POST con body { forzar: true } re-ejecuta
 * sentinel aunque la frescura no cambió (barrido genuino).
 *
 * Reglas de reconciliación (documentadas tras reproducir ambos shapes):
 *   1. Normalizar por `clave`; una entrada presente en un shape y ausente en el
 *      otro se reporta explícitamente (no se asume 0).
 *   2. El total SIEMPRE es la suma de `hallazgos.length`, nunca el campo `total`
 *      del GET (que cuenta proyectos, no hallazgos).
 *   3. La verificacio'n por proyecto usa el mismo shape de entrada; `detalle`
 *      lista los ruleId de cada hallazgo para cruzar con los baselines del plan.
 */
import { existsSync, readFileSync } from 'node:fs' ;
import { dirname, join, resolve } from 'node:path' ;
import { fileURLToPath } from 'node:url' ;

const __dirname = dirname(fileURLToPath(import.meta.url)) ;
const AREA = resolve(__dirname, '../../..') ;
const BASE = process.env.AGREGADO_BASE || 'http://127.0.0.1:8787';

// Proyectos que la misión 308A-6/7 sigue (los demás — freebuff-bridge,
// GLORYINSPECTOR, glory-sentinel, .quality-tools-* — son repos del área fuera
// del alcance; se listan pero no cuentan para la misión). glory-harness se
// integró al harness de convergencia varsense el 2026-09-02 (analyze-blocks.mjs,
// decisión del usuario) aunque sus hallazgos de Sentinel (llm.rs) no forman
// parte de este agregado de varsense.
const MISION = new Set([
  'workspace-manager','RESTAURANTE','TRABAJOS CLIENTES/ONG AGAPE','WANDORIUS',
  'coolify-manager-rs','gloryapi','Glory-Laminal','GLORYPORT','PROYECTO TASKS',
  'glory-harness',
]);

function extraerEntradas(shape, nombre) {
  // GET: shape.analisis es un mapa clave → entrada.
  // POST: shape.proyectos es un array de entradas.
  const raw = shape.analisis ?? shape.proyectos;
  const entradas = new Map();
  if (Array.isArray(raw)) {
    for (const e of raw) entradas.set(e.clave, e);
  } else if (raw && typeof raw === 'object') {
    for (const [k, e] of Object.entries(raw)) {
      const clave = e?.clave ?? k;
      entradas.set(clave, e);
    }
  }
  return { nombre, entradas };
}

function resumir(label, { nombre, entradas }) {
  let total = 0;
  const filas = [];
  for (const [clave, e] of entradas) {
    const n = (e?.hallazgos || []).length;
    total += n;
    const sev = e?.resumen ?? {};
    filas.push({
      clave,
      total: n,
      error: sev.error ?? 0,
      warning: sev.warning ?? 0,
      information: sev.information ?? 0,
      hint: sev.hint ?? 0,
      fuente: e?.fuente ?? '?',
      version: e?.version ?? '?',
      analizadoEn: e?.analizadoEn ?? null,
      estados: [...new Set((e?.hallazgos || []).map((h) => h.ruleId))],
    });
  }
  filas.sort((a, b) => b.total - a.total);
  return { label, total, filas };
}

async function main() {
  const soloMision = process.argv.includes('--solo-mision');
  const wantsJson = process.argv.includes('--json');

  const getRes = await fetch(`${BASE}/api/gate/analisis`, { signal: AbortSignal.timeout(120000) });
  const getShape = await getRes.json();
  const postRes = await fetch(`${BASE}/api/gate/analizar-todo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ forzar: true }),
    signal: AbortSignal.timeout(300000),
  });
  const postShape = await postRes.json();

  const getE = extraerEntradas(getShape, 'GET /analisis');
  const postE = extraerEntradas(postShape, 'POST /analizar-todo');
  const getR = resumir('GET /api/gate/analisis', getE);
  const postR = resumir('POST /api/gate/analizar-todo', postE);

  // Diferencia: solo GET / solo POST (claves no presentes en el otro shape).
  const claves = new Set([...getE.entradas.keys(), ...postE.entradas.keys()]);
  const soloGet = [...getE.entradas.keys()].filter((k) => !postE.entradas.has(k));
  const soloPost = [...postE.entradas.keys()].filter((k) => !getE.entradas.has(k));

  if (wantsJson) {
    console.log(JSON.stringify({
      base: BASE,
      get: getR,
      post: postR,
      discrepancias: { soloGet, soloPost },
      mision: postR.filas.filter((f) => MISION.has(f.clave))
        .reduce((s, f) => s + f.total, 0),
    }, null, 2));
    return;
  }

  console.log(`Agregado vivo ${BASE} — barrido forzado (POST) vs cache (GET)\n`);
  console.log(`GET  total hallazgos  : ${getR.total} (campo total del shape = nº proyectos: ${getShape.total})`);
  console.log(`POST total hallazgos  : ${postR.total} (escaneadoEn ${postShape.escaneadoEn})`);
  console.log(`Solo presentes en GET : ${soloGet.join(', ') || '—'}`);
  console.log(`Solo presentes en POST: ${soloPost.join(', ') || '—'}`);
  console.log(`\nPor proyecto (POST, barrido forzado):`);
  for (const f of postR.filas) {
    const marca = MISION.has(f.clave) ? '' : '  [fuera de misión]';
    console.log(
      `  ${String(f.total).padStart(5)} ${f.clave.padEnd(32)} ` +
        `(e${f.error}/w${f.warning}/i${f.information}/h${f.hint}) ${f.fuente}${marca}`,
    );
  }
  const totalMision = postR.filas.filter((f) => MISION.has(f.clave))
    .reduce((s, f) => s + f.total, 0);
  console.log(`\nTotal misión (9 proyectos rastreados): ${totalMision}`);
  console.log('(PROYECTO TASKS incluye el WIP del usuario — se reporta, no se compara)');
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});