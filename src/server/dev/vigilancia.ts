/* Vigilancia del mando dev (F0b): el servidor ejecuta el doctor en el mismo
 * proceso y lo sirve por /api/dev/estado.
 * [por que] El CLI scripts/dev/doctor.mjs ya clasifica (bajo-mando, sin-boton,
 * deriva, huerfanos); duplicar esa logica en TS la desincronizaria. El server
 * escribe el snapshot vigente a un temporal, invoca al doctor con
 * --snapshot-file y parsea su JSON: la misma clasificacion en CLI y consola,
 * sin tuberia paralela. Usa snapshotArea (src/server/snapshot.ts), la misma
 * sutura que las rutas del gate/config, sin importar el entry (sin ciclos).
 * Coste 11-14 s por la ruta del servidor, hasta ~23 s sin snapshot (sensores
 * PowerShell/CIM) -> cache TTL 60s + single-flight; el
 * informe lleva tomadoEn para que la consola muestre la frescura. */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InformeDev } from '../../shared/dev.js';
import { snapshotArea } from '../snapshot.js';

/* Doctor relativo a este archivo (src/server/dev/ -> raiz del repo), no al
 * cwd: el servidor puede arrancarse desde cualquier directorio. */
const DOCTOR = join(import.meta.dirname, '..', '..', '..', 'scripts', 'dev', 'doctor.mjs');

/* TTL 60s (decision del spike F0: scan async con frescura visible en vez de
 * bloquear cada GET; el coste real del doctor es ~23 s, ver TIMEOUT_DOCTOR_MS). */
const TTL_MS = 60_000;

/* [por que] Medido 11-14 s con --snapshot-file y 22.8 s sin el; con el
 * backend bajo carga, el techo anterior de 30 s se quedaba corto y la consola
 * mostraba un "SyntaxError" que ocultaba el timeout. 60 s da margen (~2.6x
 * sobre lo peor medido) sin dejar colgado el GET (single-flight + TTL 60 s). */
const TIMEOUT_DOCTOR_MS = 60_000;

let cache: { en: number; informe: InformeDev } | null = null;
let inflight: Promise<{ informe: InformeDev; escaneadoHaceMs: number }> | null = null;

function ejecutarDoctor(snapshotTmp: string): Promise<{ salida: string; fallo?: string }> {
  return new Promise((res) => {
    /* [por que] El doctor sale con 0/1/2 segun clasificacion (exit 2 =
     * degradado es estado VALIDO, no fallo): la salida se aprovecha venga con
     * el codigo que venga; el motivo solo importa si no hay JSON. */
    execFile(
      process.execPath,
      [DOCTOR, '--all', '--json', '--snapshot-file', snapshotTmp],
      { timeout: TIMEOUT_DOCTOR_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        const salida = String(stdout ?? '');
        if (!err) return res({ salida });
        /* [por que] Distinguir el timeout (killed) de un codigo de salida:
         * antes ambos llegaban como "SyntaxError: Unexpected end of JSON". */
        const fallo = err.killed
          ? `timeout ${TIMEOUT_DOCTOR_MS} ms`
          : `salida ${String(err.code ?? '?')}`;
        res({ salida, fallo });
      },
    );
  });
}

function informeFalla(detalle: string): InformeDev {
  return {
    version: 1,
    tomadoEn: new Date().toISOString(),
    snapshotEn: null,
    ttlMs: TTL_MS,
    errorSensor: detalle.slice(0, 300),
    proyectos: [],
    huerfanos: [],
  };
}

export async function obtenerVigilancia(): Promise<{
  informe: InformeDev;
  escaneadoHaceMs: number;
}> {
  const ahora = Date.now();
  if (cache && ahora - cache.en < TTL_MS) {
    return { informe: cache.informe, escaneadoHaceMs: ahora - cache.en };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const { snapshot } = snapshotArea(false);
    const dir = mkdtempSync(join(tmpdir(), 'wm-dev-'));
    try {
      const tmp = join(dir, 'snapshot.json');
      writeFileSync(tmp, JSON.stringify(snapshot));
      const { salida, fallo } = await ejecutarDoctor(tmp);
      if (!salida) throw new Error(`doctor sin salida (${fallo ?? 'vacía'})`);
      const informe = JSON.parse(salida) as InformeDev;
      if (!informe || !Array.isArray(informe.proyectos)) {
        throw new Error('salida del doctor sin forma de InformeDev');
      }
      cache = { en: Date.now(), informe };
      return { informe, escaneadoHaceMs: Date.now() - cache.en };
    } catch (err) {
      /* [por que] Fail-loud: si el doctor no produce informe se sirve un
       * informe de fallo (no un 500 vacio) para que la consola lo pinte. */
      const informe = informeFalla(`doctor dev sin informe: ${String(err)}`);
      cache = { en: Date.now(), informe };
      return { informe, escaneadoHaceMs: 0 };
    } finally {
      inflight = null;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Buffer temporal, mejor esfuerzo. */
      }
    }
  })();
  return inflight;
}
