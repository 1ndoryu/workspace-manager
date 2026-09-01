#!/usr/bin/env node
/**
 * 318A-7V13 — Harness de análisis por bloques.
 *
 * Reemplaza los ~20 scripts desechables (v9_brk/v10_det/v11_inline/v12_clasif...)
 * usados en los bloques V9-V12 con un único comando:
 *
 *   node scripts/quality/analyze-blocks.mjs <proyecto> [--json] [--detalle ruleId]
 *
 * Qué hace, en orden:
 *   1. Ejecuta el CLI varsense PINNEADO (dist del checkout compartido fijado
 *      por este proyecto) sobre el repo del proyecto, scope `all`.
 *   2. Resume: total por severidad + desglose por regla y por archivo.
 *   3. Clasifica cada hallazgo contra el registro estructurado de excepciones
 *      (`scripts/quality/excepciones.json`), sembrado con las familias ya
 *      verificadas en 318A-7V2..V12 (evidencia en el plan §J-11).
 *   4. Veredicto de convergencia: si TODOS los hallazgos están cubiertos por el
 *      registro, el proyecto entra en modo mantenimiento.
 *
 * Uso con otro runtime: los consumidores del área fijan su propio binario; este
 * harness usa el checkout compartido `.quality-tools/varsense` que es el que el
 * analizador del servidor (8787) ejecuta, para reproducir el agregado vivo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AREA = resolve(__dirname, '../../..');

// Nombre de proyecto (argumento) → path relativo al área + config fixada.
// Solo los proyectos con `variableFiles` correcto y análisis activo.
const PROYECTOS = {
  'workspace-manager': 'workspace-manager',
  RESTAURANTE: 'RESTAURANTE',
  'ONG AGAPE': 'TRABAJOS CLIENTES/ONG AGAPE',
  WANDORIUS: 'WANDORIUS',
  'coolify-manager-rs': 'coolify-manager-rs',
  gloryapi: 'gloryapi',
  'Glory-Laminal': 'Glory-Laminal',
  GLORYPORT: 'GLORYPORT',
  'PROYECTO TASKS': 'PROYECTO TASKS',
};

const VARSENSE_CLI = join(
  AREA,
  '.quality-tools/varsense/dist/cli/index.js',
);
const EXCEPCIONES = join(__dirname, 'excepciones.json');

function severidadKey(s) {
  const sev = String(s || '').toLowerCase();
  if (sev.startsWith('err')) return 'errores';
  if (sev.startsWith('warn')) return 'warnings';
  if (sev.startsWith('info')) return 'informativos';
  if (sev.startsWith('hint')) return 'hints';
  return 'otros';
}

function cubiertoPorRegistro(regla, ruta, message, proyectos) {
  const familias = proyectos
    .flatMap((p) => p.familias || [])
    .filter((f) => f.regla === regla);
  if (familias.length === 0) return null;
  const basename = ruta.split(/[\\/]/).pop();
  // El CLI reporta rutas con separador del SO; normalizamos a '/' para que
  // los patrones de excepciones.json funcionen igual en Windows y POSIX.
  const rutaNorm = ruta.replace(/\\/g, '/');
  for (const f of familias) {
    // Filtro por archivos cuando la familia lo declara (patrón o sufijo).
    if (Array.isArray(f.archivos) && f.archivos.length > 0) {
      const match = f.archivos.some((a) => {
        if (a.startsWith('*.')) return basename.endsWith(a.slice(1));
        return basename === a || rutaNorm.includes(a);
      });
      if (!match) continue;
    }
    // Filtro por marca textual cuando la familia lo declara (p. ej. selector).
    if (Array.isArray(f.marcas) && f.marcas.length > 0) {
      if (!f.marcas.some((m) => message.includes(m))) continue;
    }
    return f;
  }
  return null;
}

function main() {
  const arg = process.argv[2];
  if (!arg || !PROYECTOS[arg]) {
    console.error(
      `Uso: node scripts/quality/analyze-blocks.mjs <proyecto> [--json] [--detalle ruleId]\n` +
        `Proyectos: ${Object.keys(PROYECTOS).join(', ')}`,
    );
    process.exit(2);
  }
  if (!existsSync(VARSENSE_CLI)) {
    console.error(`Falta el CLI varsense pinneado en ${VARSENSE_CLI}`);
    process.exit(1);
  }
  const repo = join(AREA, PROYECTOS[arg]);
  if (!existsSync(repo)) {
    console.error(`No existe el repo ${repo}`);
    process.exit(1);
  }

  const wantsJson = process.argv.includes('--json');
  const detalle = process.argv.includes('--detalle')
    ? process.argv[process.argv.indexOf('--detalle') + 1]
    : null;

  // 1) Baseline con runtime fijado.
  // El CLI puede salir con status != 0 cuando hay errores (p. ej. el
  // variableNoDefinida del WIP) aunque el JSON de salida sea válido; el reporte
  // es lo que importa, no el exit code.
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [VARSENSE_CLI, 'all', '--workspace', repo, '--format', 'json'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    out = e.stdout;
    if (!out) throw e;
  }
  const res = JSON.parse(out);

  const reglas = new Map();
  const archivos = new Map();
  let totales = { errores: 0, warnings: 0, informativos: 0, hints: 0 };
  const crudos = [];

  for (const entry of res.entries || []) {
    const key = entry.ruta.startsWith(repo) ? entry.ruta.slice(repo.length + 1) : entry.ruta;
    const arch = archivos.get(key) || { total: 0, porRegla: new Map() };
    for (const f of entry.findings || []) {
      const sev = severidadKey(f.severity);
      totales[sev] = (totales[sev] || 0) + 1;
      arch.total += 1;
      const n = arch.porRegla.get(f.ruleId) || 0;
      arch.porRegla.set(f.ruleId, n + 1);
      const r = reglas.get(f.ruleId) || { [sev]: 0, archivos: new Set() };
      r[sev] = (r[sev] || 0) + 1;
      r.archivos.add(key);
      reglas.set(f.ruleId, r);
      crudos.push({
        regla: f.ruleId,
        severidad: f.severity,
        ruta: key,
        linea: (f.range?.start?.line ?? 0) + 1,
        mensaje: f.message,
        metadata: f.metadata || null,
      });
    }
    archivos.set(key, arch);
  }
  const total = crudos.length;

  // 2) Veredicto de convergencia contra el registro.
  let registro = { proyectos: [] };
  if (existsSync(EXCEPCIONES)) {
    try {
      registro = JSON.parse(readFileSync(EXCEPCIONES, 'utf8'));
    } catch {
      console.warn('excepciones.json no parsea — veredicto sin cobertura');
    }
  }
  const proyReg = (registro.proyectos || []).find(
    (p) => p.proyecto === arg,
  );
  const descubiertos = new Map();
  let cubiertos = 0;
  for (const c of crudos) {
    const fam = cubiertoPorRegistro(c.regla, c.ruta, c.mensaje, proyReg ? [proyReg] : []);
    if (fam) {
      cubiertos += 1;
    } else {
      const k = `${c.regla}::${c.ruta}::${c.linea}`;
      descubiertos.set(k, c);
    }
  }
  const enMantenimiento =
    proyReg !== undefined && descubiertos.size === 0;

  // 3) Salida.
  if (wantsJson) {
    console.log(
      JSON.stringify(
        {
          proyecto: arg,
          total,
          totales,
          porRegla: Object.fromEntries(
            [...reglas.entries()].map(([k, v]) => [
              k,
              { total: (v.errores || 0) + (v.warnings || 0) + (v.informativos || 0) + (v.hints || 0), ...v, archivos: v.archivos.size },
            ]),
          ),
          porArchivo: Object.fromEntries(
            [...archivos.entries()].map(([k, v]) => [
              k,
              { total: v.total, porRegla: Object.fromEntries(v.porRegla) },
            ]),
          ),
          cobertura: { cubiertos, descubiertos: descubiertos.size },
          enMantenimiento,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`=== ${arg} — varsense (runtime fijado) ===`);
  console.log(
    `Total: ${total} — ${totales.errores} errores / ${totales.warnings} warnings / ` +
      `${totales.informativos} informativos / ${totales.hints} hints`,
  );
  if (res.cache?.utilizada) {
    console.log(`(resultado de cache: ${res.cache.utilizada})`);
  }
  console.log('\nPor regla:');
  for (const [k, v] of [...reglas.entries()].sort((a, b) =>
    b[1].errores + b[1].warnings - (a[1].errores + a[1].warnings),
  )) {
    const t = (v.errores || 0) + (v.warnings || 0) + (v.informativos || 0) + (v.hints || 0);
    console.log(
      `  ${k}: ${t} ` +
        `(e${v.errores || 0}/w${v.warnings || 0}/i${v.informativos || 0}/h${v.hints || 0}) en ${v.archivos.size} archivo(s)`,
    );
  }

  if (detalle) {
    const filtrados = crudos.filter((c) => c.regla === detalle);
    console.log(`\nDetalle ${detalle} (${filtrados.length}):`);
    for (const c of filtrados) {
      console.log(`  ${c.ruta}:${c.linea} — ${c.mensaje}`);
    }
  } else {
    console.log('\nPor archivo (top 15):');
    for (const [k, v] of [...archivos.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15)) {
      const ps = [...v.porRegla.entries()]
        .map(([r, n]) => `${r}x${n}`)
        .join(', ');
      console.log(`  ${k}: ${v.total} (${ps})`);
    }
  }

  console.log('\n=== Veredicto de convergencia ===');
  if (!proyReg) {
    console.log(
      `Sin entrada en excepciones.json para ${arg} — sembrar el registro o clasificar manualmente.`,
    );
  } else if (descubiertos.size === 0) {
    console.log(`MANTENIMIENTO — ${total} hallazgos, todos cubiertos por el registro.`);
  } else {
    console.log(
      `ACCIONABLE — ${descubiertos.size}/${total} hallazgos fuera del registro:`,
    );
    for (const c of descubiertos.values()) {
      console.log(`  ${c.regla} ${c.ruta}:${c.linea} — ${c.mensaje}`);
    }
  }
  if (proyReg) {
    console.log(
      `Cobertura del registro: ${cubiertos}/${total} ` +
        `(familias: ${(proyReg.familias || []).length})`,
    );
  }
}

main();