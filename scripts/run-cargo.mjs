#!/usr/bin/env node

/* Compila y prueba la app de escritorio en la VPS 89.
 * [por que] El portátil no tiene toolchain de Rust desde el 2026-10-16 (AGENTS §1).
 * Este wrapper es la vía única: delega en `rcargo.mjs` (sync por Mutagen, target
 * remoto bajo cm-heavy, target de Windows forzado) y aquí no se ejecuta cargo. */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RCARGO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remoto');
const taller = await import(pathToFileURL(path.join(RCARGO_DIR, 'rcargo.mjs')).href);
const argvCargo = process.argv.slice(2);
const config = taller.cargarConfig();
const proyecto = taller.detectarProyecto(process.cwd());

if (taller.modoEfectivo(argvCargo, config, proyecto) !== 'remoto') {
  /* El modo local ya no existe: se sale en claro en vez de fallar con un ENOENT. */
  console.error('[run-cargo] El portátil no compila Rust: quita --local y compila en el taller.');
  process.exit(1);
}

const r = spawnSync(process.execPath, [path.join(RCARGO_DIR, 'rcargo.mjs'), ...argvCargo], { stdio: 'inherit' });
process.exit(r.status ?? 1);
