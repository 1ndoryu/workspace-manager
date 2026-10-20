#!/usr/bin/env node
/**
 * 318A-7V13 — Harness de análisis por bloques.
 *
 * Reemplaza los ~20 scripts desechables (v9_brk/v10_det/v11_inline/v12_clasif...)
 * usados en los bloques V9-V12 con un único comando:
 *
 *   node scripts/quality/auditoria/analyze-blocks.mjs <proyecto> [--json] [--detalle ruleId]
 *
 * Qué hace, en orden:
 *   1. Ejecuta el CLI varsense PINNEADO (dist del checkout compartido fijado
 *      por este proyecto) sobre el repo del proyecto, scope `all`.
 *   2. Resume: total por severidad + desglose por regla y por archivo.
 *   3. Clasifica cada hallazgo contra el registro estructurado de excepciones
 *      (`config/quality-excepciones.json`), sembrado con las familias ya
 *      verificadas en 318A-7V2..V12 (evidencia en el plan §J-11). Formato v2
 *      (318A-7V16): entradas por proyecto con `familias` (reglas amplias con
 *      archivos/marcas y `conteo` esperado) y `pares` (hallazgos
 *      token-duplicate verificados 1:1 por archivo + par de tokens).
 *   4. Veredicto de convergencia: si TODOS los hallazgos están cubiertos por el
 *      registro (por familia o por par) y los `conteo` de las familias
 *      coinciden con lo medido (sin DRIFT), el proyecto entra en modo
 *      mantenimiento. Un conteo que se mueve sin registrarse (DRIFT) rompe el
 *      veredicto: nuevo hallazgo absorbido o resuelto sin documentar.
 *
 * Uso con otro runtime: los consumidores del área fijan su propio binario; este
 * harness usa el checkout compartido `.quality-tools/varsense` que es el que el
 * analizador del servidor (8787) ejecuta, para reproducir el agregado vivo.
 *
 * Reparto: reglas puras en analyze-blocks-reglas.mjs, lectura de registro en
 * analyze-blocks-registro.mjs y salida por consola en analyze-blocks-salida.mjs.
 */
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarTaller, decidirDonde } from '../../shared/vps.mjs';
import { correrEnVps, correrLocal } from './varsense-ejecucion.mjs';
import { agregar, calcularDrift, clasificar } from './analyze-blocks-reglas.mjs';
import { leerExcepciones, reposDelRegistro } from './analyze-blocks-registro.mjs';
import { imprimirJson, imprimirTexto } from './analyze-blocks-salida.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const arg = process.argv[2];
  const repos = reposDelRegistro();
  if (!arg || !repos.has(arg)) {
    console.error(
      `Uso: node scripts/quality/auditoria/analyze-blocks.mjs <proyecto> [--json] [--detalle ruleId] [--local]\n` +
        `Proyectos: ${[...repos.keys()].join(', ')}`,
    );
    process.exit(2);
  }
  const taller = cargarTaller();
  let destino;
  try {
    destino = decidirDonde(process.argv, taller, hostname());
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (destino.aviso) console.error(destino.aviso);
  const repo = repos.get(arg);
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
  const { out, repoEjecucion } = destino.donde === 'remoto' ? correrEnVps(arg, repo, taller) : correrLocal(repo);
  const res = JSON.parse(out);

  const { reglas, archivos, totales, crudos } = agregar(res, repoEjecucion);
  const total = crudos.length;

  // 2) Veredicto de convergencia contra el registro.
  const registro = leerExcepciones();
  const proyReg = (registro.proyectos || []).find(
    (p) => p.proyecto === arg,
  );
  const { descubiertos, cubiertos, porEntrada } = clasificar(crudos, proyReg);
  const drift = calcularDrift(proyReg, porEntrada);
  const enMantenimiento =
    proyReg !== undefined && descubiertos.size === 0 && drift.length === 0;

  // 3) Salida.
  const resultado = {
    arg, res, total, totales, reglas, archivos, crudos,
    cubiertos, descubiertos, drift, proyReg, enMantenimiento, detalle,
  };
  if (wantsJson) {
    imprimirJson(resultado);
    return;
  }
  imprimirTexto(resultado);
}

main();
