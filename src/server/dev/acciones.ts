/* Ejecutor de acciones del mando dev (F3): el servidor invoca al CLI
 * scripts/dev/dev.mjs en un hijo sin shell y devuelve { codigo, salida }.
 * [por que] El CLI ya decide (ya-arriba/arrancado/rehusado, stop con
 * revalidacion PID, logs acotados): duplicar esa logica en TS la
 * desincronizaria, igual que F0b rehusó duplicar el doctor. El server solo
 * valida el id contra el registro (falla cerrado), escribe el snapshot
 * vigente a un temporal (nunca a ciegas) y propaga el codigo del CLI.
 * `up` puede tardar hasta arranqueMs: el timeout se lee del registro con
 * margen, topado a 6 min (localhost; el cliente muestra espera). */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotArea } from '../snapshot.js';

const DIR_DEV = join(import.meta.dirname, '..', '..', '..', 'scripts', 'dev');
const DEV_MJS = join(DIR_DEV, 'dev.mjs');
const RUTA_REGISTRO = join(DIR_DEV, 'registro.json');

export type AccionDev = 'up' | 'stop' | 'status' | 'logs' | 'open';

export interface ResultadoAccionDev {
  codigo: number;
  salida: string;
}

/* Id con la misma forma que el puente (NOMBRE_OK): el CLI ya falla ante
 * id ausente del registro, pero el server no invoca nada sin id valido. */
const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function arranqueMsDe(id: string): number {
  const crudo = JSON.parse(readFileSync(RUTA_REGISTRO, 'utf8')) as {
    proyectos?: { id?: unknown; arranqueMs?: unknown }[];
  };
  const e = crudo.proyectos?.find((p) => p.id === id);
  if (!e) throw new Error(`sin entrada en registro para '${id}'`);
  const ms = typeof e.arranqueMs === 'number' ? e.arranqueMs : 60_000;
  return Math.min(Math.max(ms, 5_000), 300_000) + 30_000;
}

const TIMEOUT_FIJO: Record<Exclude<AccionDev, 'up'>, number> = {
  stop: 60_000,
  status: 60_000,
  logs: 30_000,
  open: 30_000,
};

export async function ejecutarAccionDev(
  accion: AccionDev,
  id: string,
  lineas?: number,
): Promise<ResultadoAccionDev> {
  if (!ID_OK.test(id)) throw new Error(`id invalido '${id}'`);
  const timeout = accion === 'up' ? arranqueMsDe(id) : TIMEOUT_FIJO[accion];
  const dir = mkdtempSync(join(tmpdir(), 'wm-dev-'));
  try {
    /* Snapshot vigente a temporal (snapshotArea ya es la sutura usada por
     * vigilancia F0b): las acciones con sensor nunca deciden a ciegas;
     * logs/open lo ignoran (solo registro) pero se sirve igual. */
    const { snapshot } = snapshotArea(false);
    const tmp = join(dir, 'snapshot.json');
    writeFileSync(tmp, JSON.stringify(snapshot));
    const argv =
      accion === 'logs'
        ? [DEV_MJS, 'logs', id, '--lineas', String(lineas ?? 50)]
        : [DEV_MJS, accion, id, '--snapshot-file', tmp, '--json'];
    const r = await new Promise<{ codigo: number; salida: string }>((res) => {
      execFile(
        process.execPath,
        argv,
        { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          const code = typeof (err as { code?: unknown } | null)?.code === 'number'
            ? (err as { code: number }).code
            : 0;
          /* [por que] logs/open fallan por stderr (console.error) y up/stop/
           * status por stdout: stdout vacio no es "sin salida", es mirar el
           * otro canal. Sin este fallback el tablero mostraba vacio ante un
           * rehusado legible. */
          const txt = String(stdout ?? '');
          const salida = txt.trim() ? txt : String(stderr ?? '');
          /* Timeout del hijo = instrumento roto (1), no estado del area. */
          res({ codigo: err ? code || 1 : 0, salida: salida.trim().slice(0, 4000) });
        },
      );
    });
    /* --json imprime el objeto ({ resumen } en up/stop y en los refusals;
     * status verde imprime { estado, motivo }): se devuelve texto legible,
     * no el JSON crudo; logs no tiene --json y su salida ya es el texto. */
    if (argv.includes('--json')) {
      try {
        const obj = JSON.parse(r.salida) as { resumen?: unknown; estado?: unknown; motivo?: unknown };
        if (typeof obj.resumen === 'string') return { codigo: r.codigo, salida: obj.resumen };
        if (typeof obj.estado === 'string' && typeof obj.motivo === 'string') {
          return { codigo: r.codigo, salida: `${obj.estado} ${id} ${obj.motivo}` };
        }
      } catch {
        /* Salida no-JSON (error del CLI): se propaga tal cual. */
      }
    }
    return r;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Buffer temporal, mejor esfuerzo. */
    }
  }
}
