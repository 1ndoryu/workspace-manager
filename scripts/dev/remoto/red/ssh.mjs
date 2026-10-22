/* SSH al taller: ejecutar un comando y dejar un archivo en la VPS. */

import { argsSsh, shQuote } from '../../../remoto/rcargo.mjs';
import { BIN_SSH } from '../../../shared/binarios.mjs';
import { execFile, spawn } from 'node:child_process';

export function sshRemoto(config, comando, timeoutMs = 30_000) {
  return new Promise((resolveP) => {
    execFile(BIN_SSH, argsSsh(config, [comando]), { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolveP({
        ok: !err,
        codigo: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        salida: String(stdout ?? ''),
        error: String(stderr || err?.message || '').trim().slice(0, 300),
      });
    });
  });
}

// [por que] El contenido viaja por stdin: no aparece en la línea de comando ni en `ps`. Temporal + mv: nunca un archivo a medias.

export function escribirArchivoRemoto(config, ruta, contenido, timeoutMs = 30_000) {
  const tmp = `${ruta}.tmp-${process.pid}`;
  // [por que] mkdir -p del padre en la misma llamada: el directorio puede no existir aún (primer `up` de un proyecto).
  const comando = `mkdir -p ${shQuote(ruta.slice(0, ruta.lastIndexOf('/')))} && umask 077 && cat > ${shQuote(tmp)} && chmod 600 ${shQuote(tmp)} && mv -f ${shQuote(tmp)} ${shQuote(ruta)}`;
  return new Promise((resolveP) => {
    const hijo = spawn(BIN_SSH, argsSsh(config, [comando]), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    hijo.stderr.on('data', (d) => { stderr += d; });
    const reloj = setTimeout(() => hijo.kill(), timeoutMs);
    hijo.on('error', (e) => { clearTimeout(reloj); resolveP({ ok: false, codigo: 1, error: e.message }); });
    hijo.on('close', (code) => {
      clearTimeout(reloj);
      resolveP({ ok: code === 0, codigo: code ?? 1, error: stderr.trim().slice(0, 300) });
    });
    hijo.stdin.end(contenido);
  });
}

