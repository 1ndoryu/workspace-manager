/* Lectura única del sistema del laptop (procesos, servicios y sockets TCP), compartida por
 * el taller (conformidad L1/L2) y por la vigilancia (doctor de la consola).
 * [por que] Antes cada consumidor leía el SO por su cuenta en la misma consola: el taller
 * pedía Win32_Process completo y Get-NetTCPConnection (≈4,5 s en frío) y el doctor, en otro
 * proceso, netstat, CIM filtrado por PID y CIM de ssh. Ahora un solo CIM (procesos + servicios)
 * y un solo netstat, con caché de 60 s y single-flight, sirven a los dos. Medido en frío: ≈2,5 s
 * para CIM+servicios en paralelo con netstat (~0,15 s), frente a ≈4,5 s solo del taller. */
import { PUERTO_PROCESOS, type PuertoProcesos } from './procesos.js';

export interface ProcesoSistema {
  pid: number;
  creado: string | null;
  exe: string | null;
  cmd: string | null;
  imagen: string | null;
}

export interface ServicioSistema {
  pid: number;
  nombre: string | null;
}

export interface SocketEscucha {
  ip: string;
  puerto: number;
  pid: number;
}

export interface ConexionEstablecida {
  puertoRemoto: number;
  pid: number;
}

export interface SistemaLocal {
  procesos: ProcesoSistema[];
  servicios: ServicioSistema[];
  escucha: SocketEscucha[];
  establecidas: ConexionEstablecida[];
  tomadoEn: string;
}

const TTL_MS = 60_000;
/* [por que] Mismo presupuesto que el sensor del doctor (25 s): un PowerShell colgado no bloquea la consola. */
const TIMEOUT_SENSOR_MS = 25_000;

/* [por que] Una sola llamada a PowerShell para CIM: el nombre de cada listener sale del mismo
 * inventario de procesos, sin una segunda consulta. Los servicios van en la misma llamada porque
 * su coste extra (≈0,5 s) es menor que un arranque de PowerShell aparte. */
const SCRIPT_CIM = `
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Stop'
$procesos = @(Get-CimInstance Win32_Process | Select-Object @{n='pid';e={$_.ProcessId}},@{n='creado';e={$_.CreationDate.ToString('o')}},@{n='exe';e={$_.ExecutablePath}},@{n='cmd';e={$_.CommandLine}},@{n='imagen';e={$_.Name}})
$servicios = @(Get-CimInstance Win32_Service -Filter 'ProcessId > 0' | Select-Object @{n='pid';e={$_.ProcessId}},@{n='nombre';e={$_.Name}})
[pscustomobject]@{ procesos = $procesos; servicios = $servicios } | ConvertTo-Json -Compress -Depth 3
`;

/* Lista de un JSON de PowerShell: un solo objeto llega sin array cuando hay un elemento. */
function aLista<T>(x: T | T[] | null | undefined): T[] {
  return Array.isArray(x) ? x : x ? [x] : [];
}

/* Parsea `netstat -ano`. [por que] Sin `-p TCP`: en Windows ese filtro omite los listeners
 * IPv6 ([::1]:5176). Espejo de `parsearNetstat` del doctor (scripts/dev/doctor/sistema/procesos.mjs);
 * un test compara ambos para que no se separen. */
export function parsearNetstatEscucha(sal: string): SocketEscucha[] {
  const filas: SocketEscucha[] = [];
  for (const linea of sal.split(/\r?\n/)) {
    const t = linea.trim().split(/\s+/);
    if (t.length !== 5 || t[0] !== 'TCP' || !/LISTEN/i.test(t[3])) continue;
    /* [por que] La dirección IPv6 local viene entre corchetes: [::1]:5174. */
    const corte = t[1].lastIndexOf(':');
    const ip = t[1].slice(0, corte).replace(/^\[|\]$/g, '');
    const puerto = Number(t[1].slice(corte + 1));
    const pid = Number(t[4]);
    if (Number.isInteger(puerto) && Number.isInteger(pid)) filas.push({ ip, puerto, pid });
  }
  return filas;
}

/* Espejo de `parsearEstablecidas` del doctor. En la fila del cliente el puerto remoto es el
 * listener: su pid dice quién lo usa (p. ej. el backend que usa el túnel de BD). */
export function parsearNetstatEstablecidas(sal: string): ConexionEstablecida[] {
  const filas: ConexionEstablecida[] = [];
  for (const linea of sal.split(/\r?\n/)) {
    const t = linea.trim().split(/\s+/);
    if (t.length !== 5 || t[0] !== 'TCP' || t[3] !== 'ESTABLISHED') continue;
    const puertoRemoto = Number(t[2].slice(t[2].lastIndexOf(':') + 1));
    const pid = Number(t[4]);
    if (Number.isInteger(puertoRemoto) && Number.isInteger(pid)) filas.push({ puertoRemoto, pid });
  }
  return filas;
}

/* Lee el sistema con el puerto de procesos recibido (inyectable en tests). Las dos lecturas
 * van a la vez: CIM tarda ≈1,5-2,5 s y netstat ≈0,15 s. */
export async function leerSistemaLocal(puerto: PuertoProcesos = PUERTO_PROCESOS): Promise<SistemaLocal> {
  const codigo = Buffer.from(SCRIPT_CIM, 'utf16le').toString('base64');
  const [cim, netstat] = await Promise.all([
    puerto.ejecutar(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codigo],
      { timeout: TIMEOUT_SENSOR_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    ),
    puerto.ejecutar('netstat.exe', ['-ano'], { timeout: TIMEOUT_SENSOR_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true }),
  ]);
  let j: { procesos?: unknown; servicios?: unknown };
  try {
    j = JSON.parse(cim.stdout.trim());
  } catch {
    throw new Error('sistema local: JSON inesperado de Get-CimInstance');
  }
  return {
    procesos: aLista<ProcesoSistema>(j.procesos as ProcesoSistema[]).filter((p) => Number.isInteger(p?.pid)),
    servicios: aLista<ServicioSistema>(j.servicios as ServicioSistema[]).filter((s) => Number.isInteger(s?.pid)),
    escucha: parsearNetstatEscucha(netstat.stdout),
    establecidas: parsearNetstatEstablecidas(netstat.stdout),
    tomadoEn: new Date().toISOString(),
  };
}

/* Caché de 60 s y single-flight: el taller y la vigilancia de una misma consola comparten
 * una sola lectura. Un fallo no se cachea: la siguiente petición vuelve a intentarlo.
 * [por que] El cargador y el TTL se inyectan para poder probar la caché sin PowerShell. */
export function crearCacheSistema(
  cargar: () => Promise<SistemaLocal>,
  ttlMs = TTL_MS,
  ahora: () => number = Date.now,
): () => Promise<SistemaLocal> {
  let cache: { en: number; sistema: SistemaLocal } | null = null;
  let inflight: Promise<SistemaLocal> | null = null;
  return () => {
    if (cache && ahora() - cache.en < ttlMs) return Promise.resolve(cache.sistema);
    if (inflight) return inflight;
    inflight = cargar()
      .then((sistema) => {
        cache = { en: ahora(), sistema };
        return sistema;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

export const obtenerSistemaLocal = crearCacheSistema(() => leerSistemaLocal());

/* Nombre del proceso dueño de cada listener, para el informe del taller (L2 filtra por nombre). */
export function escuchasConProceso(
  sistema: SistemaLocal,
): { direccion: string; puerto: number; proceso: string }[] {
  const nombres = new Map(sistema.procesos.map((p) => [p.pid, p.imagen ?? '']));
  return sistema.escucha.map((e) => ({ direccion: e.ip, puerto: e.puerto, proceso: nombres.get(e.pid) ?? '' }));
}
