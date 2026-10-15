/* Estado del taller remoto (VPS 89) y del entorno local, con las reglas de conformidad
 * (S3, plan sucesor 2026-10-14). El manager corre en el laptop (AGENTS §9.2): la 89 se lee
 * por SSH con la sonda de solo lectura `taller-estado`; los hostnames públicos se piden sin
 * credenciales; procesos, escuchas y Mutagen se leen con PowerShell.
 * [por que] Cada lectura cuesta (una sesión SSH, PowerShell de 1-2 s): el resultado se cachea
 * 60 s y las peticiones simultáneas comparten una sola lectura (single-flight). Así el panel y
 * la consola no multiplican sesiones SSH. */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluarConformidad,
  type EntradaConformidad,
  type EstadoLocal,
  type EstadoPublico,
  type EstadoTaller89,
  type Hallazgo,
  type MuestraHistorial,
  type RegistroConformidad,
} from '../../shared/taller/conformidad.js';

const RUTA_REGISTRO = join(import.meta.dirname, '..', '..', '..', 'scripts', 'dev', 'registro.json');
/* Alias SSH del taller (AGENTS §9.4): el único acceso SSH directo autorizado. */
const TALLER_HOST = 'dev89';
const SONDA_TALLER = '$HOME/bin/taller-estado';
const TTL_MS = 60_000;
const TIMEOUT_SSH_MS = 15_000;
const TIMEOUT_PUBLICO_MS = 6_000;
const TIMEOUT_LOCAL_MS = 20_000;
const HOST_OK = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export interface EstadoTallerCompleto {
  tomadoEn: string;
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

/* ---------- Registro ---------- */

interface ProyectoRegistro {
  id?: unknown;
  host?: unknown;
  puertos?: unknown;
  puertosRemotos?: unknown;
  hostsPublicos?: unknown;
  puertosPublicos?: unknown;
  buildMode?: unknown;
}

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const numeros = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

/* Lo que el registro declara y debe cumplirse. Sitios Rust: solo los que declaran buildMode;
 * un Rust sin declarar no se evalúa (cobertura limitada, dicho en el resumen). */
export function leerRegistroConformidad(): RegistroConformidad {
  const crudo = JSON.parse(readFileSync(RUTA_REGISTRO, 'utf8')) as { proyectos?: ProyectoRegistro[] };
  const sesionesDev: string[] = [];
  const hostsPublicos = new Set<string>();
  const puertosLocalesPublicos = new Set<number>();
  const sitiosRust: RegistroConformidad['sitiosRust'] = [];
  for (const p of crudo.proyectos ?? []) {
    const id = typeof p.id === 'string' ? p.id : '';
    if (!id) continue;
    /* [por que] Las sesiones tmux remotas se llaman dev-<id>-<puerto> (scripts/dev/remoto.mjs:27)
     * y el puerto es el remoto (puertosRemotos ?? puertos, remoto.mjs:30). */
    if (typeof p.host === 'string' && p.host !== '') {
      for (const puerto of numeros(p.puertosRemotos ?? p.puertos)) sesionesDev.push(`dev-${id}-${puerto}`);
    }
    textos(p.hostsPublicos).forEach((h) => hostsPublicos.add(h));
    numeros(p.puertosPublicos).forEach((n) => puertosLocalesPublicos.add(n));
    if ('buildMode' in p) sitiosRust.push({ id, buildMode: typeof p.buildMode === 'string' ? p.buildMode : null });
  }
  return {
    sesionesDev,
    hostsPublicos: [...hostsPublicos],
    puertosLocalesPublicos: [...puertosLocalesPublicos],
    sitiosRust,
  };
}

/* ---------- VPS 89 (sonda por SSH) ---------- */

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const esNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
  const r = await correr('ssh', [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    TALLER_HOST,
    SONDA_TALLER,
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
  const r = await correr('ssh', [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    TALLER_HOST,
    `tail -n ${HISTORIAL_LINEAS} ${RUTA_HISTORIAL_REMOTA} 2>/dev/null || true`,
  ], TIMEOUT_SSH_MS);
  if (r.error) return { historial: [], motivo: r.error };
  const historial = parsearHistorial(r.salida);
  return historial.length > 0
    ? { historial }
    : { historial, motivo: 'sin muestras todavía (el cron de la sonda aún no ha escrito)' };
}

/* ---------- HTTP público (P1, sin credenciales) ---------- */

async function pedirPublico(host: string): Promise<EstadoPublico['hosts'][number]> {
  if (!HOST_OK.test(host)) return { host, status: null, location: null, error: 'hostname no válido en el registro' };
  try {
    /* [por que] redirect manual: la prueba es si Cloudflare redirige a Access (Location), no
     * seguir hasta la página de login. Node no envía cookies: la petición va sin credenciales. */
    const res = await fetch(`https://${host}/`, {
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
  return { hosts: await Promise.all(hosts.map(pedirPublico)) };
}

/* ---------- Laptop (procesos, escuchas, Mutagen) ---------- */

/* [por que] -EncodedCommand evita el reparto de comillas entre Node y PowerShell.
 * Si Get-NetTCPConnection falla, el script termina con error y L0 lo dice (no se calla). */
const SCRIPT_LOCAL = `
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Stop'
$cim = @{}
foreach ($p in (Get-CimInstance Win32_Process)) { $cim[[int]$p.ProcessId] = $p }
$procesos = @($cim.Values | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; nombre = [string]$_.Name; cmd = [string]$_.CommandLine } })
$escuchas = @(Get-NetTCPConnection -State Listen | ForEach-Object {
  $dueno = $cim[[int]$_.OwningProcess]
  [pscustomobject]@{ direccion = [string]$_.LocalAddress; puerto = [int]$_.LocalPort; proceso = $(if ($dueno) { [string]$dueno.Name } else { '' }) }
})
$mutagenPresente = [bool](Get-Command mutagen -ErrorAction SilentlyContinue)
$mutagenOk = $false
$mutagenSalida = ''
if ($mutagenPresente) {
  try {
    $mutagenSalida = (& mutagen sync list 2>&1 | Out-String)
    $mutagenOk = ($LASTEXITCODE -eq 0)
  } catch {
    $mutagenSalida = $_.ToString()
  }
}
[pscustomobject]@{ procesos = $procesos; escuchas = $escuchas; mutagenPresente = $mutagenPresente; mutagenOk = $mutagenOk; mutagenSalida = $mutagenSalida } | ConvertTo-Json -Compress -Depth 4
`;

/* Sesiones taller-* de Mutagen malas: parada, con conflictos o con problemas.
 * [por que] El formato de `mutagen sync list` no se ha verificado en este laptop (Mutagen no
 * está en el PATH); el parser es conservador: sin «Watching» u otro estado de sync, avisa. */
export function sesionesMutagenMalas(salida: string): string[] {
  const malas: string[] = [];
  for (const bloque of salida.split(/^(?=Name: )/m)) {
    const nombre = /^Name: (.+)$/m.exec(bloque)?.[1]?.trim();
    if (!nombre || !nombre.startsWith('taller-')) continue;
    const estado = /^Status: (.+)$/m.exec(bloque)?.[1]?.trim() ?? 'sin estado';
    const enSync = /Watching|Scanning|Staging|Reconciling|Synchronizing|Saving|Transitioning/i.test(estado);
    if (!enSync || /^(Conflicts|Problems):/m.test(bloque)) malas.push(`${nombre} (${estado})`);
  }
  return malas;
}

async function leerLocal(): Promise<EstadoLocal> {
  const r = await correr('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(SCRIPT_LOCAL, 'utf16le').toString('base64'),
  ], TIMEOUT_LOCAL_MS);
  if (r.error) return { procesos: [], escuchas: [], mutagen: null, sinLectura: r.error };
  let d: {
    procesos: EstadoLocal['procesos'];
    escuchas: EstadoLocal['escuchas'];
    mutagenPresente: boolean;
    mutagenOk: boolean;
    mutagenSalida: string;
  };
  try {
    d = JSON.parse(r.salida);
  } catch {
    return { procesos: [], escuchas: [], mutagen: null, sinLectura: 'PowerShell no devolvió JSON' };
  }
  return {
    procesos: d.procesos,
    escuchas: d.escuchas,
    mutagen: d.mutagenPresente
      ? { daemonVivo: d.mutagenOk, sesionesMalas: sesionesMutagenMalas(d.mutagenSalida) }
      : null,
  };
}

/* ---------- Composición, caché de 60 s y single-flight ---------- */

async function calcular(): Promise<EstadoTallerCompleto> {
  const registro = leerRegistroConformidad();
  const [taller, publico, local, hist] = await Promise.all([
    leerTaller89(),
    leerPublico(registro.hostsPublicos),
    leerLocal(),
    leerHistorial(),
  ]);
  const entrada: EntradaConformidad = {
    t89: taller.t89,
    motivoSinLectura: taller.motivo,
    publico,
    local,
    registro,
  };
  return {
    tomadoEn: new Date().toISOString(),
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
