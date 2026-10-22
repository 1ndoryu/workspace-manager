/* Sincronizacion del gate (plan centralizar-gate 308A-1 F7).
 * [por que] El panel debe mostrar en la UI el estado real de centralizacion:
 * si cada consumidor apunta al checkout compartido .quality-tools/ con el
 * mismo commit, con badges verde/desync. La validacion ya existe en
 * scripts/quality-sync.mjs (fail-closed, escribe nada): este modulo NO
 * duplica esa logica, la REUTILIZA ejecutando el script --json y devolviendo
 * su reporte parseado. El cliente es 'tonto': pide /api/gate/sincronizacion y
 * muestra; aqui se resuelve la corrida sin tocar el escaneo raiz. */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../shared/logger.js';
import type { ReporteAlineacion, ReporteSincronizacion } from '../../shared/gate/sincronizacion.js';

/* Raiz del repo workspace-manager: el modulo vive en src/server/gate/, a
 * TRES niveles bajo la raiz (src -> server -> gate). */
const RAIZ_REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Ruta del script de validacion en-repo. [por que] Esta junto al server dentro
 * de workspace-manager (scripts/quality-sync.mjs) y NO dentro de ningun
 * proyecto; se ejecuta con node (entry, sin shell) para seguridad. */
function rutaScript(): string {
  return join(RAIZ_REPO, 'scripts', 'quality-sync', 'quality-sync.mjs');
}


/* Ejecuta quality-sync --json y parsea su stdout.
 * [por que] El script con --json imprime el JSON en stdout y sale con 0
 * (alineado) o 1 (desync); aqui nos interesa el reporte, no el codigo del
 * script (la UI muestra si hay desync). Por eso usamos spawn y leemos stdout
 * hasta 'close' en vez de execFile promisificado (que lanzaria en exit!=0 por
 * el desync real de proyecto-ejemplo). Lanza solo si el proceso muere o el stdout no
 * es JSON (nunca se devuelve un reporte inventado). */
/* Cache en memoria del ultimo informe, con marca de tiempo.
 * [por que] El informe cuesta ~8,4 s medidos: recorre cada consumidor y, por
 * cada checkout distinto, lanza varios procesos git mas un ls-remote contra su
 * remoto. La pestaña Gate lo pide al abrirse, asi que sin cache cada apertura
 * paga el precio entero. La cache NO manda sobre el dato: caduca, y el boton
 * 'verificar alineacion' pide `forzar`, que la salta. Servir un informe viejo
 * indefinidamente seria peor que no tener cache. */
const CACHE_MS = 60_000;
let cache: { en: number; reporte: ReporteSincronizacion } | null = null;

export async function correrSincronizacion(
  forzar = false,
  entorno: NodeJS.ProcessEnv = process.env,
): Promise<ReporteSincronizacion> {
  if (!forzar && cache && Date.now() - cache.en < CACHE_MS) return cache.reporte;
  const script = rutaScript();
  const hijo = spawn(process.execPath, [script, '--json'], {
    cwd: RAIZ_REPO,
    windowsHide: true,
    env: { ...entorno },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: Buffer[] = [];
  let stderr = '';
  hijo.stdout.on('data', (c: Buffer) => chunks.push(c));
  hijo.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
  });
  const codigo = await new Promise<number | null>((resolve, reject) => {
    hijo.once('error', reject);
    hijo.once('close', resolve);
  });
  if (codigo === null) {
    throw new Error(`quality-sync no llego a ejecutarse: ${stderr.trim()}`);
  }
  const texto = Buffer.concat(chunks).toString('utf8').trim();
  // [por que] El script con --json siempre imprime el JSON en stdout; si no,
  // falla claro (nunca se fabrica un reporte parcial ni se depende del exit).
  const obj = JSON.parse(texto) as ReporteSincronizacion;
  /* Alineacion V19 (219A-1): best-effort, nunca rompe el reporte F7. Si el
   * script falla o su red (ls-remote) no responde, alineacion=null y el panel
   * muestra solo el bloque F7. */
  try {
    obj.alineacion = await correrAlineacion();
  } catch (err) {
    logger.warn('alineacion pin/runtime no disponible:', err);
    obj.alineacion = null;
  }
  cache = { en: Date.now(), reporte: obj };
  return obj;
}

/* Ejecuta verificar-alineacion.mjs --json (308A-7V19) y devuelve su reporte.
 * [por que] Mismo patron que correrSincronizacion: el script sale con 1 ante
 * desalineamiento real (hoy 7/17 filas varsense), asi que se lee stdout hasta
 * 'close' sin depender del codigo. Solo lanza si el stdout no es JSON. */
export async function correrAlineacion(entorno: NodeJS.ProcessEnv = process.env): Promise<ReporteAlineacion> {
  const script = join(RAIZ_REPO, 'scripts', 'quality', 'auditoria', 'verificar-alineacion.mjs');
  const hijo = spawn(process.execPath, [script, '--json'], {
    cwd: RAIZ_REPO,
    windowsHide: true,
    env: { ...entorno },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: Buffer[] = [];
  let stderr = '';
  hijo.stdout.on('data', (c: Buffer) => chunks.push(c));
  hijo.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
  });
  const codigo = await new Promise<number | null>((resolve, reject) => {
    hijo.once('error', reject);
    hijo.once('close', resolve);
  });
  if (codigo === null) {
    throw new Error(`verificar-alineacion no llego a ejecutarse: ${stderr.trim()}`);
  }
  const texto = Buffer.concat(chunks).toString('utf8').trim();
  return JSON.parse(texto) as ReporteAlineacion;
}