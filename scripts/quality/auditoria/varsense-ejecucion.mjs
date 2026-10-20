/* Dónde corre varsense para el análisis de bloques: en la VPS configurada (por defecto) o en este
 * equipo solo con `--local` (emergencia). Separado de analyze-blocks.mjs por el límite de líneas. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';

import { NOMBRE_QUALITY_TOOLS_REMOTO, RAIZ_AREA } from '../../shared/rutas.mjs';
import { dirRemotoDe, ejecutarEnVps, mensajeSinVps } from '../../shared/vps.mjs';

const VARSENSE_CLI = join(RAIZ_AREA, '.quality-tools/varsense/dist/cli/index.js');

/* Varsense pinneado en este equipo: solo con `--local` (emergencia). */
export function correrLocal(repo) {
  if (!existsSync(VARSENSE_CLI)) {
    console.error(`Falta el CLI varsense pinneado en ${VARSENSE_CLI}`);
    process.exit(1);
  }
  try {
    return { out: execFileSync(process.execPath, [VARSENSE_CLI, 'all', '--workspace', repo, '--format', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }), repoEjecucion: repo };
  } catch (e) {
    // El CLI sale con status != 0 si hay errores; su JSON sigue siendo válido.
    if (!e.stdout) throw e;
    return { out: e.stdout, repoEjecucion: repo };
  }
}

/* Varsense en la VPS (carga pesada, bajo cm-heavy): réplica del proyecto y CLI bajo _quality-tools.
 * Las rutas de los hallazgos son remotas; por eso se devuelve `repoEjecucion` para recortarlas. */
export function correrEnVps(id, repo, taller) {
  const dir = dirRemotoDe(taller, id, repo, repo);
  const cli = posix.join(taller.dirRemotoBase, NOMBRE_QUALITY_TOOLS_REMOTO, id, 'varsense/dist/cli/index.js');
  const r = ejecutarEnVps(taller, dir, ['node', cli, 'all', '--workspace', dir, '--format', 'json'], { capturar: true });
  const aviso = mensajeSinVps(r.status, taller.host);
  if (aviso) {
    console.error(aviso);
    process.exit(2);
  }
  if (!r.stdout) {
    console.error(`varsense en la VPS no devolvió JSON (exit ${r.status}); mira el error de arriba`);
    process.exit(1);
  }
  return { out: r.stdout, repoEjecucion: dir };
}
