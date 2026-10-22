#!/usr/bin/env node
/* Ejecutor de tests del manager. Regla de la usuaria (2026-10-19): los tests corren en la
 * VPS configurada, nunca en este equipo. Uso desde package.json:
 *   node scripts/dev/ejecutar-tests.mjs [--local] node --test <ficheros>
 *
 *  - En la 89 (hostname = hostnameTaller): ejecuta aqui.
 *  - Otro equipo con VPS configurada (config/taller.json): lanza el mismo comando en la VPS, en la réplica.
 *  - Sin VPS configurada: ejecuta aqui con aviso (un clon sin taller tiene que poder probarse).
 *    `--local` sigue siendo la emergencia explicita con taller configurado.
 */

import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import path, { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RAIZ_REPO } from '../shared/rutas.mjs';
import { FLAG_LOCAL, cargarTaller, decidirDonde, dirRemotoDe, ejecutarEnVps, mensajeSinVps } from '../shared/vps.mjs';

export { cargarTaller };

function main(argv) {
  const comando = argv.filter((a) => a !== FLAG_LOCAL);
  if (comando.length === 0) {
    console.error('ejecutar-tests: falta el comando de test');
    return 64;
  }
  const config = cargarTaller();
  let destino;
  try {
    destino = decidirDonde(argv, config, hostname());
  } catch (error) {
    console.error(`ejecutar-tests: ${error.message}`);
    return 2;
  }
  if (destino.aviso) console.error(`ejecutar-tests: ${destino.aviso}`);

  if (destino.donde === 'remoto') {
    console.error(`ejecutar-tests: los tests corren en la VPS configurada (${config.host}), no en este equipo.`);
    const dir = dirRemotoDe(config, basename(RAIZ_REPO), RAIZ_REPO, RAIZ_REPO);
    const r = ejecutarEnVps(config, dir, comando);
    const aviso = mensajeSinVps(r.status, config.host);
    if (aviso) console.error(`ejecutar-tests: ${aviso}`);
    return r.status ?? 1;
  }
  return spawnSync(comando[0], comando.slice(1), { stdio: 'inherit', cwd: RAIZ_REPO }).status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
