/* Helpers de proceso de quality:setup (E/S): ejecutan git y leen la versión del CLI
 * provisionado. Sin estado propio: el taller y el destino los decide el adaptador. */

import { spawnSync } from 'node:child_process';
import { BIN_GIT } from '../shared/binarios.mjs';

export function run(cmd, args, cwd, label) {
  // En Windows `npm` es un shim (npm.cmd): spawnSync solo lo ejecuta con shell.
  // [por qué] Con ruta absoluta puede haber espacios (Program Files): va entre comillas.
  const cmdTexto = /\s/.test(cmd) ? `"${cmd}"` : cmd;
  const result = spawnSync([cmdTexto, ...args].join(' '), { cwd, stdio: 'inherit', windowsHide: true, shell: true });
  if (result.error) {
    process.stderr.write(`[quality:setup] no se pudo ejecutar ${label}: ${result.error.message}\n`);
    process.exit(2);
  }
  if (result.status !== 0) {
    process.stderr.write(`[quality:setup] ${label} falló (exit ${result.status}); no se escribe evidencia\n`);
    process.exit(1);
  }
}

export function git(cwd, ...args) {
  const result = spawnSync(BIN_GIT, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

/* Refresca las refs del checkout antes de dar por bueno el pin.
 *
 * [por que] `doctor` decide `tool-release-unpublished` con
 * `git for-each-ref --contains <commit> refs/remotes refs/tags` sobre el propio
 * checkout, y esas refs SOLO avanzan con un fetch. Provisionar con
 * `git checkout <sha>` las deja atrás, así que el pin recién puesto sale «no
 * publicado» aunque sí lo esté: el 2026-10-16 los 9 consumidores alineados
 * dieron `doctor no-listo` con dos issues por esta causa, y se arreglaron a
 * mano con un fetch. Best-effort y con timeout: sin remoto, sin red o con un
 * remoto que no responde se avisa y se sigue, porque el fetch no es la
 * evidencia —la evidencia es compile + suite sobre el commit. */
export function refrescarRefs(source, name) {
  const remoto = git(source, 'remote', 'get-url', 'origin');
  if (!remoto) return;
  /* Sin `--tags`: con él, una etiqueta local que apunte a otro sitio aborta el
   * fetch entero («would clobber existing tag», visto con v0.7.6) y el aviso
   * saldría por un motivo que no impide nada. El refspec por defecto ya trae
   * las etiquetas alcanzables sin pisar las existentes. */
  const resultado = spawnSync(BIN_GIT, ['fetch', 'origin'], {
    cwd: source,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
  if (resultado.error || resultado.status !== 0) {
    process.stdout.write(
      `[quality:setup] ${name}: no se pudo refrescar ${remoto} (${resultado.error?.code ?? `exit ${resultado.status}`}); ` +
        'las refs de release pueden quedar obsoletas\n',
    );
  }
}

/* Versión que declara el CLI provisionado, o null si no se puede leer. Misma
 * invocación que el lock-generator: `node <cli> --version` desde el workspace. */
export function versionDelCli(cli, cwd) {
  const resultado = spawnSync(process.execPath, [cli, '--version'], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  if (resultado.error || resultado.status !== 0) return null;
  return (resultado.stdout ?? '').trim() || null;
}
