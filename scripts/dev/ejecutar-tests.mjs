#!/usr/bin/env node
/* Ejecutor de tests del manager. Regla de la usuaria (2026-10-19): los tests corren en la
 * VPS 89, nunca en el portatil. Uso desde package.json:
 *   node scripts/dev/ejecutar-tests.mjs node --test <ficheros>
 *
 *  - Portatil con taller configurado: BLOQUEA la ejecucion local y lanza el mismo
 *    comando en la 89 (cm-heavy, en la replica ~/taller/<proyecto>).
 *  - En la 89 (hostname = hostnameTaller): ejecuta aqui.
 *  - Sin taller configurado (clon publico): ejecuta aqui con aviso. Es el modo sin VPS.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path, { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BIN_SSH } from '../shared/binarios.mjs';
import { RAIZ_REPO, rutaConfigPrivada } from '../shared/rutas.mjs';
import { shQuote } from '../remoto/rcargo.mjs';

// [por que] `bash -lc` no activa fnm: node no esta en el PATH sin esta linea (ver comandos.mjs).
const PATH_NODE = 'export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"; ';

export function cargarTaller(ruta = rutaConfigPrivada('taller.json')) {
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

/* Decide donde corre el test. Funcion pura: el equipo se pasa como argumento.
 * Devuelve { donde: 'aqui' | 'remoto', aviso? }. */
export function decidir(config, equipo) {
  if (!config) return { donde: 'aqui', aviso: 'sin taller configurado: los tests corren en este equipo (modo sin VPS)' };
  if (!config.hostnameTaller) throw new Error('taller.json sin hostnameTaller: no se sabe si este equipo es la 89');
  return { donde: equipo === config.hostnameTaller ? 'aqui' : 'remoto' };
}

// Comando que corre en la 89: dentro de la replica del proyecto, con el lock de carga pesada.
export function comandoRemoto(config, proyecto, argv) {
  const dir = `${config.dirRemotoBase}/${proyecto}`;
  const interno = `${PATH_NODE}cd ${shQuote(dir)} && ${argv.map(shQuote).join(' ')}`;
  return `${config.lockWrapper} bash -lc ${shQuote(interno)}`;
}

function main(argv) {
  if (argv.length === 0) {
    console.error('ejecutar-tests: falta el comando de test');
    return 64;
  }
  const config = cargarTaller();
  const { donde, aviso } = decidir(config, hostname());
  if (aviso) console.error(`ejecutar-tests: ${aviso}`);

  if (donde === 'remoto') {
    console.error(`ejecutar-tests: los tests corren en la VPS 89 (${config.host}), no en este equipo.`);
    const cmd = comandoRemoto(config, basename(RAIZ_REPO), argv);
    return spawnSync(BIN_SSH, ['-o', 'BatchMode=yes', config.host, cmd], { stdio: 'inherit' }).status ?? 1;
  }
  return spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', cwd: RAIZ_REPO }).status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
