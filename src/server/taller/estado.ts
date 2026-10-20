/* Estado del taller remoto (VPS 89) y del entorno local, con las reglas de conformidad
 * (S3, plan sucesor 2026-10-14). El manager corre en el laptop (AGENTS §9.2): la 89 se lee
 * por SSH con la sonda de solo lectura `taller-estado`; los hostnames públicos se piden sin
 * credenciales; procesos, escuchas y Mutagen se leen con PowerShell.
 * [por que] Cada lectura cuesta (una sesión SSH, PowerShell de 1-2 s): el resultado se cachea
 * 60 s y las peticiones simultáneas comparten una sola lectura (single-flight). Así el panel y
 * la consola no multiplican sesiones SSH. */
import { execFile } from 'node:child_process';
import {
  evaluarConformidad,
  type EntradaConformidad,
  type EstadoLocal,
  type EstadoPublico,
  type EstadoTaller89,
  type Hallazgo,
  type MuestraHistorial,
} from '../../shared/taller/conformidad.js';
import { hostsActivos } from '../../shared/taller/conformidadPublico.js';
import { leerRegistroConformidad } from './registroConformidad.js';
import { NOMBRE_MANAGER } from '../plataforma/rutas.js';
import { BIN_SSH } from '../plataforma/binarios.js';
import { escuchasConProceso, obtenerSistemaLocal } from '../plataforma/sistemaLocal.js';
import { esNumero, esObjeto } from '../../shared/guardas.js';
import { bdTrabajoDe, hostTaller, leerConfigRemota } from '../gate/herramientas/config.js';

/* Alias SSH del taller. [por que] Antes era la constante 'dev89' incrustada: el alias
 * de la máquina de una persona, que en otro entorno no existe. Lo declara taller.json
 * (`host`), que es privado; sin ese fichero no hay taller que leer y se dice. */
const SONDA_TALLER = '$HOME/bin/taller-estado';
const TTL_MS = 60_000;
const TIMEOUT_SSH_MS = 15_000;
const TIMEOUT_PUBLICO_MS = 6_000;
const TIMEOUT_LOCAL_MS = 20_000;
const HOST_OK = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export interface EstadoTallerCompleto {
  tomadoEn: string;
  /* Alias SSH del taller declarado en la config privada; null si no hay taller. */
  host: string | null;
  hallazgos: Hallazgo[];
  entrada: EntradaConformidad;
  historial: MuestraHistorial[];
  motivoHistorial: string | null;
}

/* Lectura de un comando sin shell. `error` es null si salió con 0; si no, la primera línea
 * de stderr (o del propio error), acotada. */
function correr(archivo: string, args: string[], timeoutMs: number): Promise<{ salida: string; error: string | null }> {
  return new Promise((resolver) => {
    execFile(archivo, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const salida = String(stdout ?? '');
        if (!err) return resolver({ salida, error: null });
        const detalle = String(stderr || err.message).trim().split('\n')[0].slice(0, 300);
        resolver({ salida, error: detalle || 'error sin detalle' });
      });
  });
}

/* ---------- VPS 89 (sonda por SSH) ---------- */

/* Comprueba la forma antes de confiar en el JSON: una sonda desactualizada o rota no debe
 * producir hallazgos falsos ni «sano» por campos ausentes. */
function errorFormaTaller89(x: unknown): string | null {
  if (!esObjeto(x)) return 'la sonda no devolvió un objeto';
  if (x.version !== 1) return `versión de sonda no soportada (${String(x.version)})`;
  const ok = esObjeto(x.disco) && esNumero(x.disco.libreGb)
    && esObjeto(x.sweep)
    && esObjeto(x.memoria) && esNumero(x.memoria.disponibleMiB) && esNumero(x.memoria.swapUsadaMiB)
    && Array.isArray(x.escuchas) && Array.isArray(x.tmux)
    && esObjeto(x.cmHeavy) && Array.isArray(x.buildsFueraDeCmHeavy) && Array.isArray(x.secretos)
    && esObjeto(x.cloudflared) && esObjeto(x.bdTrabajo) && typeof x.managerDaemonVivo === 'boolean';
  return ok ? null : 'la sonda devolvió campos incompletos';
}

async function leerTaller89(): Promise<{ t89: EstadoTaller89 | null; motivo?: string }> {
  const host = hostTaller();
  if (!host) return { t89: null, motivo: 'sin taller configurado (falta `host` en la config privada)' };
  const r = await correr(BIN_SSH, [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    host,
    // [por que] El nombre de la BD de trabajo es del proyecto, no del código: llega por entorno.
    'env', `TALLER_BD_TRABAJO=${bdTrabajoDe() ?? ''}`, SONDA_TALLER,
  ], TIMEOUT_SSH_MS);
  if (r.error) return { t89: null, motivo: r.error };
  let crudo: unknown;
  try {
    crudo = JSON.parse(r.salida);
  } catch {
    return { t89: null, motivo: 'la sonda no devolvió JSON' };
  }
  const forma = errorFormaTaller89(crudo);
  return forma ? { t89: null, motivo: forma } : { t89: crudo as EstadoTaller89 };
}

/* ---------- Historial (S3.4): estado.jsonl, que la sonda escribe con --registrar cada 5 min ---------- */

/* [por que] 48 líneas = 4 h de cron de 5 min: lo que el panel enseña, sin bajar el fichero
 * entero (rota a 5 MiB en la sonda). */
const HISTORIAL_LINEAS = 48;
const RUTA_HISTORIAL_REMOTA = '$HOME/taller/_datos/estado.jsonl';

/* Convierte el texto de estado.jsonl en muestras, de la más antigua a la más reciente. Una
 * línea rota o de otra forma se descarta sin parar la lectura: una mala no oculta las buenas. */
export function parsearHistorial(texto: string): MuestraHistorial[] {
  const muestras: MuestraHistorial[] = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    let x: unknown;
    try {
      x = JSON.parse(linea);
    } catch {
      continue;
    }
    if (errorFormaTaller89(x) || typeof (x as { tomadaEn?: unknown }).tomadaEn !== 'string') continue;
    const t = x as EstadoTaller89;
    muestras.push({
      tomadaEn: t.tomadaEn,
      libreGb: t.disco.libreGb,
      disponibleMiB: t.memoria.disponibleMiB,
      swapUsadaMiB: t.memoria.swapUsadaMiB,
      cmHeavyOcupado: t.cmHeavy.ocupado,
      cloudflaredViva: t.cloudflared.viva,
      managerDaemonVivo: t.managerDaemonVivo,
    });
  }
  return muestras;
}

/* Lectura por SSH de solo lectura. `|| true`: si el fichero aún no existe (el cron no ha
 * escrito) no es un fallo; un fallo de SSH sí sale con código distinto de 0 y se reporta. */
async function leerHistorial(): Promise<{ historial: MuestraHistorial[]; motivo?: string }> {
  const host = hostTaller();
  if (!host) return { historial: [], motivo: 'sin taller configurado' };
  const r = await correr(BIN_SSH, [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    host,
    `tail -n ${HISTORIAL_LINEAS} ${RUTA_HISTORIAL_REMOTA} 2>/dev/null || true`,
  ], TIMEOUT_SSH_MS);
  if (r.error) return { historial: [], motivo: r.error };
  const historial = parsearHistorial(r.salida);
  return historial.length > 0
    ? { historial }
    : { historial, motivo: 'sin muestras todavía (el cron de la sonda aún no ha escrito)' };
}

/* ---------- HTTP público (P1, sin credenciales) ---------- */

/* Comprueba que un host público está detrás de Access. `fetchImpl` se inyecta
 * igual que en vps/agente.ts (`fetchImpl?`): la comprobación decide si un dev
 * queda expuesto, y con el `fetch` global no se puede probar sin salir a la red. */
export async function pedirPublico(
  host: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<EstadoPublico['hosts'][number]> {
  if (!HOST_OK.test(host)) return { host, status: null, location: null, error: 'hostname no válido en el registro' };
  try {
    /* [por que] redirect manual: la prueba es si Cloudflare redirige a Access (Location), no
     * seguir hasta la página de login. Node no envía cookies: la petición va sin credenciales. */
    const res = await fetchImpl(`https://${host}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_PUBLICO_MS),
    });
    await res.body?.cancel().catch(() => undefined);
    return { host, status: res.status, location: res.headers.get('location'), error: null };
  } catch (err) {
    return { host, status: null, location: null, error: (err as Error).message.slice(0, 120) };
  }
}

async function leerPublico(hosts: string[]): Promise<EstadoPublico> {
  return { hosts: await Promise.all(hosts.map((h) => pedirPublico(h))) };
}

/* ---------- Laptop (procesos, escuchas, Mutagen) ---------- */

/* [por que] Procesos y escuchas ya no salen de aquí: los lee `sistemaLocal` (un solo CIM y un
 * netstat, compartidos con la vigilancia). Esta consulta queda solo para Mutagen, que no está en
 * esa lectura. -EncodedCommand evita el reparto de comillas entre Node y PowerShell. */
const SCRIPT_MUTAGEN = `
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Stop'
$mutagenExe = resolverMutagen
$mutagenPresente = [bool]$mutagenExe
$mutagenOk = $false
$mutagenSalida = ''
if ($mutagenPresente) {
  try {
    $mutagenSalida = (& $mutagenExe sync list 2>&1 | Out-String)
    $mutagenOk = ($LASTEXITCODE -eq 0)
  } catch {
    $mutagenSalida = $_.ToString()
  }
}
[pscustomobject]@{ mutagenPresente = $mutagenPresente; mutagenOk = $mutagenOk; mutagenSalida = $mutagenSalida } | ConvertTo-Json -Compress -Depth 4
`;

/* Mutagen del taller, tal y como lo declara la config privada. [por que] El binario
 * que hace el flush de la réplica sale de `taller.json` (`sync.binario`) y es el
 * MISMO que debe usar la sonda: adivinarlo por separado era duplicar el dato y, de
 * paso, incrustar la organización de esta máquina (`<home>\bin\mutagen`) en el
 * código. Sin taller declarado no hay ruta que ofrecer. */
function mutagenDeclarado(): string | null {
  try {
    return leerConfigRemota().mutagen;
  } catch {
    return null;
  }
}

/* [por que] `Get-Command mutagen` no basta: el binario puede estar fuera del PATH del
 * PowerShell no interactivo que arranca el manager (16AA-13). Sin esto, L3 sale en
 * error siempre y el sync L→89 no se comprueba nunca. Se prueba el PATH, luego el
 * declarado en la config y, como último recurso, donde lo deja su instalador. */
function funcionMutagen(declarado: string | null): string {
  /* Cita para PowerShell (comilla simple doblada): la ruta la escribe la config. */
  const ruta = declarado ? `'${declarado.replace(/'/g, "''")}'` : "''";
  return `
function resolverMutagen {
  $cmd = Get-Command mutagen -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidatos = @(
    ${ruta},
    (Join-Path $env:LOCALAPPDATA 'Mutagen\\mutagen.exe')
  )
  foreach ($c in $candidatos) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}
`;
}

/* Sesiones taller-* de Mutagen malas: parada, con conflictos o con problemas.
 * [por que] El parser es conservador: sin «Watching» u otro estado de sync, avisa. */
export function sesionesMutagenMalas(salida: string): string[] {
  const malas: string[] = [];
  /* PowerShell devuelve CRLF: se normaliza antes de partir por líneas. */
  for (const bloque of salida.replace(/\r\n/g, '\n').split(/^(?=Name: )/m)) {
    const nombre = /^Name: (.+)$/m.exec(bloque)?.[1]?.trim();
    if (!nombre || !nombre.startsWith('taller-')) continue;
    const estado = /^Status: (.+)$/m.exec(bloque)?.[1]?.trim() ?? 'sin estado';
    const enSync = /Watching|Scanning|Staging|Reconciling|Synchronizing|Saving|Transitioning/i.test(estado);
    if (!enSync || /^(Conflicts|Problems):/m.test(bloque)) malas.push(`${nombre} (${estado})`);
  }
  return malas;
}

/* Mutagen: presencia, daemon y sesiones malas. Null si el binario no aparece en ningún sitio. */
async function leerMutagen(): Promise<EstadoLocal['mutagen']> {
  const r = await correr('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(funcionMutagen(mutagenDeclarado()) + SCRIPT_MUTAGEN, 'utf16le').toString('base64'),
  ], TIMEOUT_LOCAL_MS);
  if (r.error) throw new Error(`mutagen: ${r.error}`);
  let d: { mutagenPresente: boolean; mutagenOk: boolean; mutagenSalida: string };
  try {
    d = JSON.parse(r.salida);
  } catch {
    throw new Error('mutagen: PowerShell no devolvió JSON');
  }
  return d.mutagenPresente ? { daemonVivo: d.mutagenOk, sesionesMalas: sesionesMutagenMalas(d.mutagenSalida) } : null;
}

/* Procesos y escuchas del sistema compartido y Mutagen, en paralelo. Si una lectura falla, la
 * otra se conserva y el motivo va a `sinLectura`: L1/L2 no se afirman sin datos, y L3 no
 * da por vivo un daemon que no se ha podido consultar. */
async function leerLocal(): Promise<EstadoLocal> {
  const [sistema, mutagen] = await Promise.allSettled([obtenerSistemaLocal(), leerMutagen()]);
  const motivos: string[] = [];
  if (sistema.status === 'rejected') motivos.push(String(sistema.reason));
  if (mutagen.status === 'rejected') motivos.push(String(mutagen.reason));
  const procesos = sistema.status === 'fulfilled'
    ? sistema.value.procesos.map((p) => ({ pid: p.pid, nombre: p.imagen ?? '', cmd: p.cmd ?? '' }))
    : [];
  return {
    procesos,
    escuchas: sistema.status === 'fulfilled' ? escuchasConProceso(sistema.value) : [],
    mutagen: mutagen.status === 'fulfilled' ? mutagen.value : null,
    ...(motivos.length ? { sinLectura: motivos.join(' / ') } : {}),
  };
}

/* ---------- Composición, caché de 60 s y single-flight ---------- */

async function calcular(): Promise<EstadoTallerCompleto> {
  const registro = leerRegistroConformidad();
  /* [por que] Local e historial no dependen de la 89: arrancan a la vez. Antes iban tras ella en serie (≈23 s en frío). */
  const [taller, local, hist] = await Promise.all([leerTaller89(), leerLocal(), leerHistorial()]);
  /* Solo el HTTP público espera a la 89: necesita sus hosts activos para sondear solo esos. */
  const publico = await leerPublico(hostsActivos(registro, taller.t89));
  const entrada: EntradaConformidad = {
    t89: taller.t89,
    motivoSinLectura: taller.motivo,
    publico,
    local,
    registro,
    hostTaller: hostTaller(),
    nombreMando: NOMBRE_MANAGER,
  };
  return {
    tomadoEn: new Date().toISOString(),
    /* Alias SSH del taller, para que la interfaz rotule la máquina con su nombre real
     * en vez de con uno incrustado. Null = no hay taller configurado. */
    host: hostTaller(),
    hallazgos: evaluarConformidad(entrada),
    entrada,
    historial: hist.historial,
    motivoHistorial: hist.motivo ?? null,
  };
}

let cache: { en: number; valor: EstadoTallerCompleto } | null = null;
let vuelo: Promise<EstadoTallerCompleto> | null = null;

/* Estado del taller. `forzar` ignora la caché (no el vuelo en curso: ya es fresco). Un error
 * de registro o de lectura propio se propaga; no se cachea. */
export function estadoTaller(forzar = false): Promise<EstadoTallerCompleto> {
  if (!forzar && cache && Date.now() - cache.en < TTL_MS) return Promise.resolve(cache.valor);
  if (vuelo) return vuelo;
  const p = calcular().then((valor) => {
    cache = { en: Date.now(), valor };
    return valor;
  }).finally(() => {
    vuelo = null;
  });
  vuelo = p;
  return p;
}
