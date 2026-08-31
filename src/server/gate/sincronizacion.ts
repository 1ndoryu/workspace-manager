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

/* Raiz del area (misma fuente del server). */
const RAIZ_AREA = process.env.WS_AREA_ROOT || 'C:/Users/Owner/OneDrive/Documentos/area-trabajo';

/* Raiz del repo workspace-manager: el modulo vive en src/server/gate/, a
 * TRES niveles bajo la raiz (src -> server -> gate). */
const RAIZ_REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Ruta del script de validacion en-repo. [por que] Esta junto al server dentro
 * de workspace-manager (scripts/quality-sync.mjs) y NO dentro de ningun
 * proyecto; se ejecuta con node (entry, sin shell) para seguridad. */
function rutaScript(): string {
  return join(RAIZ_REPO, 'scripts', 'quality-sync.mjs');
}

/* Tipos del reporte que devuelve quality-sync.mjs --json (normalizado minimo
 * para tipar la UI; el shape real del script es authoritative). */
export interface ToolSyncState {
  estado: 'ok' | 'desync' | 'ausente';
  detalle: string;
}

export interface ConsumidorSync {
  nombre: string;
  fase: string;
  ruta: string;
  estado: 'ok' | 'desync' | 'pendiente-F4' | 'sin-manifest' | 'error';
  detalle?: string;
  problemas?: string[];
  sentinel?: ToolSyncState;
  varsense?: ToolSyncState;
}

export interface ReporteSincronizacion {
  area: string;
  checkout: string;
  consumidores: ConsumidorSync[];
  problemas: number;
  checkout_sentinel?: { head: string | null; sucio: number };
  checkout_varsense?: { head: string | null; sucio: number };
}

/* Ejecuta quality-sync --json y parsea su stdout.
 * [por que] El script con --json imprime el JSON en stdout y sale con 0
 * (alineado) o 1 (desync); aqui nos interesa el reporte, no el codigo del
 * script (la UI muestra si hay desync). Por eso usamos spawn y leemos stdout
 * hasta 'close' en vez de execFile promisificado (que lanzaria en exit!=0 por
 * el desync real de WANDORIUS). Lanza solo si el proceso muere o el stdout no
 * es JSON (nunca se devuelve un reporte inventado). */
export async function correrSincronizacion(): Promise<ReporteSincronizacion> {
  const script = rutaScript();
  const hijo = spawn(process.execPath, [script, '--json'], {
    cwd: RAIZ_REPO,
    windowsHide: true,
    env: { ...process.env },
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
  return obj;
}