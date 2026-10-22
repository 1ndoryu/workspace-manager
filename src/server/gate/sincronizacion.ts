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

/* Tope de cada script. [por que] Antes no habia tope: un `ls-remote` sin red podía
 * dejar la peticion esperando para siempre. Un minuto es más que la corrida medida
 * (~2,5 s en frío) y menos de lo que un panel debe quedarse colgado. */
const TIMEOUT_SCRIPT_MS = 60_000;

/* Ruta del script de validacion en-repo. [por que] Esta junto al server dentro
 * de workspace-manager (scripts/quality-sync/quality-sync.mjs) y NO dentro de
 * ningun proyecto; se ejecuta con node (entry, sin shell) para seguridad. */
function rutaScript(): string {
  return join(RAIZ_REPO, 'scripts', 'quality-sync', 'quality-sync.mjs');
}

/* Cache en memoria del ultimo informe, con marca de tiempo.
 * [por que] El informe cuesta ~2,5 s medidos (antes ~8,4 s, ver `docs/rendimiento.md`):
 * recorre cada consumidor y, por cada checkout distinto, lanza varios procesos git mas
 * un ls-remote contra su remoto. La pestaña Gate lo pide al abrirse, asi que sin cache
 * cada apertura paga el precio entero. La cache NO manda sobre el dato: caduca, y el
 * boton 'verificar alineacion' pide `forzar`, que la salta. Servir un informe viejo
 * indefinidamente seria peor que no tener cache. */
const CACHE_MS = 60_000;
let cache: { en: number; reporte: ReporteSincronizacion } | null = null;

/* Salida cruda de un script del gate. */
interface SalidaScript {
  texto: string;
  codigo: number | null;
}

/* Ejecuta un script con `--json` y recoge stdout hasta 'close'.
 * [por que] El script sale con 1 cuando HAY desalineamiento (es su veredicto, no un
 * fallo), asi que no sirve execFile promisificado: se lee stdout y se decide con el
 * contenido. [por que uno solo] Estaba copiado entero para los dos scripts, con el
 * mismo manejo de chunks y de stderr; una copia se quedaba sin tope de tiempo. */
function correrScript(script: string, nombre: string, entorno: NodeJS.ProcessEnv): Promise<SalidaScript> {
  return new Promise((listo, mal) => {
    const hijo = spawn(process.execPath, [script, '--json'], {
      cwd: RAIZ_REPO,
      windowsHide: true,
      env: { ...entorno },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let stderr = '';
    let vencido = false;
    hijo.stdout.on('data', (c: Buffer) => chunks.push(c));
    hijo.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    const reloj = setTimeout(() => {
      vencido = true;
      hijo.kill();
    }, TIMEOUT_SCRIPT_MS);
    hijo.once('error', (err) => {
      clearTimeout(reloj);
      mal(new Error(`${nombre} no llego a ejecutarse: ${err.message}`));
    });
    hijo.once('close', (codigo) => {
      clearTimeout(reloj);
      if (vencido) {
        mal(new Error(`${nombre} sin respuesta en ${Math.round(TIMEOUT_SCRIPT_MS / 1000)} s`));
        return;
      }
      listo({ texto: Buffer.concat(chunks).toString('utf8').trim(), codigo });
    });
  });
}

/* Parsea el stdout de un script. Lanza si no es JSON (nunca se devuelve un reporte
 * inventado ni se depende del exit code). */
function parsear<T>(salida: SalidaScript, nombre: string): T {
  try {
    return JSON.parse(salida.texto) as T;
  } catch {
    throw new Error(`${nombre} no devolvio JSON (${salida.codigo ?? 'sin codigo'})`);
  }
}

export async function correrSincronizacion(
  forzar = false,
  entorno: NodeJS.ProcessEnv = process.env,
): Promise<ReporteSincronizacion> {
  if (!forzar && cache && Date.now() - cache.en < CACHE_MS) return cache.reporte;
  /* [por que en paralelo] Los dos scripts son independientes: uno mira los pins y el
   * otro la alineacion pin/runtime/publicado. En serie, el panel esperaba la suma
   * (~3,8 s); en paralelo, el mayor (~2,5 s). La alineacion es best-effort y nunca
   * rompe el reporte F7 (que sigue siendo la guarda fail-closed). */
  const [base, alineacion] = await Promise.all([
    correrScript(rutaScript(), 'quality-sync', entorno).then((s) => parsear<ReporteSincronizacion>(s, 'quality-sync')),
    correrAlineacion(entorno).catch((err: unknown) => {
      logger.warn('alineacion pin/runtime no disponible:', err);
      return null;
    }),
  ]);
  base.alineacion = alineacion;
  cache = { en: Date.now(), reporte: base };
  return base;
}

/* Ejecuta verificar-alineacion.mjs --json (308A-7V19) y devuelve su reporte.
 * [por que] Mismo patron que correrSincronizacion: el script sale con 1 ante
 * desalineamiento real (hoy hay filas varsense desalineadas), asi que se lee stdout
 * hasta 'close' sin depender del codigo. Solo lanza si el stdout no es JSON. */
export async function correrAlineacion(entorno: NodeJS.ProcessEnv = process.env): Promise<ReporteAlineacion> {
  const script = join(RAIZ_REPO, 'scripts', 'quality', 'auditoria', 'verificar-alineacion.mjs');
  const salida = await correrScript(script, 'verificar-alineacion', entorno);
  return parsear<ReporteAlineacion>(salida, 'verificar-alineacion');
}
