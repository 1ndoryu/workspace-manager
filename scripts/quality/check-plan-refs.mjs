#!/usr/bin/env node
/*
 * check-plan-refs.mjs — Guarda de integridad documental del frente de corrección de hallazgos
 * (2026-09-06, reparación post-consolidación de PLAN-corregir-hallazgos-2026-09-06.md).
 *
 * Verifica las referencias cruzadas plan ↔ roadmap ↔ registro:
 *   1. Todo `PLAN-*.md` mencionado en roadmap.md / excepciones.json existe en disco, salvo los
 *      cuatro planes absorbidos (allowlist) — que solo pueden citarse si el archivo que los
 *      menciona declara su archivo en git (token `f1e2535^`).
 *   2. Las citas a secciones de plan eliminado («Evidencia/docs en plan §…», «en §X del plan»)
 *      solo se permiten en archivos que declaran el archivo git (`f1e2535^`).
 *   3. El plan vigente PLAN-corregir-hallazgos-2026-09-06.md existe y está referenciado por
 *      roadmap.md y excepciones.json.
 *
 * Solo valida: no muta nada. Uso: node scripts/quality/check-plan-refs.mjs
 * Exit 0 = coherente · exit 1 = DESYNC documental (con el detalle).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROAD = join(root, 'roadmap.md');
const EXC = join(root, 'scripts', 'quality', 'excepciones.json');
const PLAN_VIGENTE = 'PLAN-corregir-hallazgos-2026-09-06.md';
const ABSORBIDOS = [
  'PLAN-corregir-1408.md',
  'PLAN-corregir-hallazgos-post-gate.md',
  'PLAN-corregir-restantes-sentinel-varsense.md',
  'PLAN-cero-deuda-2026-09-02.md',
];
const ARCHIVO = 'f1e2535^';
const DANGLE = /(?:Evidencia|docs) en plan §[A-Za-z0-9-]+|en §[A-Z][A-Za-z0-9-]* del plan/;
const errs = [];
const read = (p) => readFileSync(p, 'utf8');

if (!existsSync(join(root, PLAN_VIGENTE))) {
  errs.push(`falta el plan vigente ${PLAN_VIGENTE}`);
}

const fuentes = [];
if (existsSync(ROAD)) fuentes.push(['roadmap.md', read(ROAD)]);
else errs.push(`falta ${ROAD}`);
if (existsSync(EXC)) fuentes.push(['excepciones.json', read(EXC)]);
else errs.push(`falta ${EXC}`);

for (const [label, txt] of fuentes) {
  // 1) filenames PLAN-*.md
  for (const m of txt.matchAll(/PLAN-[A-Za-z0-9-]+\.md/g)) {
    const nombre = m[0];
    if (ABSORBIDOS.includes(nombre)) {
      if (!txt.includes(ARCHIVO)) {
        errs.push(`${label}: menciona el plan absorbido ${nombre} sin declarar su archivo git (${ARCHIVO})`);
      }
    } else if (!existsSync(join(root, nombre))) {
      errs.push(`${label}: referencia al archivo ${nombre} que no existe en disco`);
    }
  }
  // 2) citas a secciones de plan eliminado sin archivo declarado
  if (DANGLE.test(txt) && !txt.includes(ARCHIVO)) {
    errs.push(`${label}: contiene citas «en plan §…»/«en §X del plan» a planes absorbidos sin declarar su archivo git (${ARCHIVO})`);
  }
}

// 3) plan vigente referenciado por ambos consumidores
for (const [label, txt] of fuentes) {
  if (!txt.includes(PLAN_VIGENTE)) errs.push(`${label}: no referencia el plan vigente ${PLAN_VIGENTE}`);
}

if (errs.length > 0) {
  console.error('DESYNC documental (check-plan-refs):');
  for (const e of errs) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`OK: referencias plan↔roadmap↔registro coherentes (plan vigente ${PLAN_VIGENTE}; absorbidos archivados en git ${ARCHIVO}).`);
