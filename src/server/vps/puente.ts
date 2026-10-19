/* Puente con el gestor de despliegues (papel `despliegue`) para la tab vps
 * (299A-5).
 * [por que] El binario vive fuera de C:\tmp (se purga cada hora):
 * COOLIFY_MANAGER_BIN o `<home>/bin/<papel despliegue>.exe` (durable) con
 * fallback a C:\tmp\bin (legacy). Cada consulta es un proceso execFile SIN
 * shell y con argv construido aqui: la allowlist no es una lista de strings
 * sino el conjunto cerrado de funciones de abajo (solo lectura; no existe
 * ninguna que acepte --repair/--alert ni comandos arbitrarios). Concurrencia
 * 1 (cola) para no apilar SSH/API contra la VPS, timeout 90 s, salida
 * acotada, secretos redactados antes de devolver nada. */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { papelDeArea, papelesDeArea } from '../plataforma/area.js';
import { RAIZ_AREA } from '../plataforma/rutas.js';
import { raizTemporales } from '../plataforma/temporales.js';

/* Nombre base del ejecutable del gestor de despliegues. [por que] Estaba
 * incrustado ('coolify-manager.exe'), igual que su carpeta: dos datos nuestros
 * en el codigo. La carpeta y el ejecutable no tienen por que llamarse igual
 * (el nuestro es `coolify-manager-rs` en disco y produce `coolify-manager`),
 * asi que la config puede declarar `despliegueBin` y, si no, vale el nombre
 * del papel — que es el caso comun (`limpiador` -> `limpiador.exe`).
 * Sin papel declarado no hay nombre: la tab vps lo dice ('sin-binario'). */
function nombreBinDespliegue(): string | null {
  const papeles = papelesDeArea();
  const base = papeles.despliegueBin ?? papeles.despliegue;
  return base ? base + (process.platform === 'win32' ? '.exe' : '') : null;
}

/* Ruta del ejecutable bajo `<dir>/bin`. Null si no hay papel que lo nombre. */
function rutaBinDespliegue(dir: string): string | null {
  const nombre = nombreBinDespliegue();
  return nombre ? join(dir, 'bin', nombre) : null;
}

/* [por que] `<home>/bin` es la ubicacion durable, fuera de C:\tmp (que se purga
 * cada hora). La raiz de temporales sale de su unico dueno (raizTemporales, que
 * ya resuelve Windows vs Linux y el override WM_TMP) en vez de escribirse a
 * mano: era el segundo sitio que sabia donde vive C:\tmp. Funcion y no
 * constante: `WS_CONFIG_ROOT` puede cambiar despues de importar (los tests
 * apuntan a un directorio temporal) y una constante llegaria tarde. */
function rutasBinDespliegue(): string[] {
  return [rutaBinDespliegue(homedir()), rutaBinDespliegue(raizTemporales())].filter(
    (r): r is string => r !== null,
  );
}

const TIMEOUT_MS = 90_000;
const MAX_SALIDA = 512 * 1024;

/* Ubicaciones que se prueban, en orden, para el mensaje de ayuda de la API.
 * [por que] El texto lo lee quien tiene que arreglar el fallo; escrito a mano
 * divergia de lo que el codigo mira de verdad (llegaba a nombrar la carpeta
 * personal del dueno del laptop). Derivado de las mismas constantes que usa
 * rutaBinario(), no puede mentir. */
export function dondeBuscarBinario(): string {
  return ['COOLIFY_MANAGER_BIN', ...rutasBinDespliegue()].join(' o ');
}

/* Ruta del `settings.json` del gestor de despliegues: la variable de entorno o
 * el fichero del propio proyecto (`<area>/<papel despliegue>/config/settings.json`).
 * [por que] El MISMO dato estaba resuelto de dos formas distintas: la semilla del
 * mapa de sitios (rutasVps) si miraba el fichero del proyecto, pero aqui solo
 * valia la variable — y aqui es donde se LANZA el binario. Sin la variable, el
 * binario no encontraba su configuracion y el panel vps avisaba «no se pudo leer
 * el listado (¿VPS inalcanzable?)»: un sintoma que no tenia nada que ver con la
 * VPS. Un solo dueno para el dato, y la variable gana (es la anulacion explicita).
 * Sin papel declarado queda solo la variable. */
export function rutaConfigDespliegue(entorno: NodeJS.ProcessEnv = process.env): string | null {
  const papel = papelDeArea('despliegue');
  const candidatos = [
    (entorno.COOLIFY_MANAGER_CONFIG ?? '').trim(),
    papel ? join(RAIZ_AREA, papel, 'config', 'settings.json') : '',
  ];
  for (const ruta of candidatos) {
    if (ruta && existsSync(ruta)) return ruta;
  }
  return null;
}

/* Nombres de sitio aceptados (dueño único; rutasVps lo reutiliza).
 * [por que] F0 midió la regex duplicada en puente y rutasVps; una sola
 * definición evita que diverjan. */
export const NOMBRE_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function rutaBinario(entorno: NodeJS.ProcessEnv = process.env): string | null {
  const porEnv = (entorno.COOLIFY_MANAGER_BIN ?? '').trim();
  if (porEnv && existsSync(porEnv)) return porEnv;
  for (const ruta of rutasBinDespliegue()) {
    if (existsSync(ruta)) return ruta;
  }
  return null;
}

/* Turno unico: las consultas se ejecutan en serie aunque lleguen a la vez.
 * [por que] Cada consulta abre SSH/API contra la misma VPS; en paralelo se
 * solapan, compiten y multiplican la carga del origen. */
let turno: Promise<void> = Promise.resolve();

function encolar<T>(trabajo: () => Promise<T>): Promise<T> {
  const resultado = turno.then(trabajo, trabajo);
  turno = resultado.then(
    () => undefined,
    () => undefined,
  );
  return resultado;
}

/* Carril paralelo para la familia list (299A-12 F2, semáforo por familia):
 * F0 midió 3 `list` en 0.1 s en paralelo, así que la familia list admite
 * hasta 3 en vuelo; la familia inspect sigue en el turno único (sus piezas
 * son pesadas y con fallos conocidos). */
const MAX_PARALELO_LIST = 3;
let enVueloList = 0;
const colaList: Array<() => void> = [];

function tomarCarrilList(): Promise<void> {
  if (enVueloList < MAX_PARALELO_LIST) {
    enVueloList += 1;
    return Promise.resolve();
  }
  return new Promise((resolver) => {
    colaList.push(() => {
      enVueloList += 1;
      resolver();
    });
  });
}

function soltarCarrilList(): void {
  const siguiente = colaList.shift();
  if (siguiente) siguiente();
  else enVueloList = Math.max(0, enVueloList - 1);
}

/* Redacta pares evidentes de secretos en texto humano (logs/health pueden
 * arrastrarlos). Dominios y UUIDs se conservan: no son secretos. */
export function redactar(texto: string): string {
  return texto.replace(
    /(api[_-]?key|token|password|passwd|secret)\s*[:=]\s*(\S+)/gi,
    '$1=···',
  );
}

function configArg(): string[] {
  const ruta = rutaConfigDespliegue();
  return ruta ? ['-c', ruta] : [];
}

function validarNombre(sitio: string): void {
  if (!NOMBRE_OK.test(sitio)) throw new Error(`nombre-invalido: ${sitio}`);
}

async function correr(argv: string[]): Promise<string> {
  const bin = rutaBinario();
  if (!bin) throw new Error('sin-binario');
  return encolar(() => ejecutar(bin, argv));
}

async function correrParalelo(argv: string[]): Promise<string> {
  const bin = rutaBinario();
  if (!bin) throw new Error('sin-binario');
  await tomarCarrilList();
  try {
    return await ejecutar(bin, argv);
  } finally {
    soltarCarrilList();
  }
}

function ejecutar(bin: string, argv: string[]): Promise<string> {
  return new Promise<string>((resolver, rechazar) => {
    execFile(
      bin,
      argv,
      { timeout: TIMEOUT_MS, maxBuffer: MAX_SALIDA, windowsHide: true },
      (err, stdout, stderr) => {
        const salida = redactar(String(stdout ?? ''));
        if (err) {
          const causa =
            (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true
              ? 'timeout'
              : redactar(String(stderr ?? err.message)).slice(0, 300);
          rechazar(new Error(`manager-fallo: ${causa}`));
          return;
        }
        resolver(salida);
      },
    );
  });
}

/* Version cacheada (corta: 15 s) para el /config y la trazabilidad. */
let versionCache: { cuando: number; valor: string | null } = { cuando: 0, valor: null };

export async function versionBinario(): Promise<string | null> {
  if (Date.now() - versionCache.cuando < 60_000) return versionCache.valor;
  const bin = rutaBinario();
  if (!bin) {
    versionCache = { cuando: Date.now(), valor: null };
    return null;
  }
  try {
    const salida = await new Promise<string>((resolver, rechazar) => {
      execFile(bin, ['--version'], { timeout: 15_000, windowsHide: true }, (err, stdout) => {
        if (err) rechazar(err);
        else resolver(String(stdout ?? '').trim());
      });
    });
    versionCache = { cuando: Date.now(), valor: salida };
    return salida;
  } catch {
    versionCache = { cuando: Date.now(), valor: null };
    return null;
  }
}

/* --- Allowlist: solo estas funciones construyen argv. Ninguna acepta flags
 * de escritura (--repair, --alert, deploy, restart...): no existen aqui. --- */

export function listarSitios(detallado: boolean): Promise<string> {
  return correrParalelo(['list', ...(detallado ? ['--detailed'] : []), ...configArg()]);
}

export function salud(sitio?: string): Promise<string> {
  const argv = ['health', ...configArg()];
  if (sitio !== undefined) {
    validarNombre(sitio);
    argv.push('-n', sitio);
  } else {
    argv.push('--all');
  }
  return correr(argv);
}

export function logs(sitio: string, lineas: number, objetivo?: string): Promise<string> {
  validarNombre(sitio);
  const n = Math.min(200, Math.max(1, Math.floor(lineas) || 50));
  const argv = ['logs', '-n', sitio, '-l', String(n), ...configArg()];
  if (objetivo !== undefined) {
    if (!NOMBRE_OK.test(objetivo)) throw new Error(`objetivo-invalido: ${objetivo}`);
    argv.push('--target', objetivo);
  }
  return correr(argv);
}

async function comoJson(argv: string[]): Promise<unknown> {
  const salida = await correr(argv);
  try {
    return JSON.parse(salida) as unknown;
  } catch {
    throw new Error('json-invalido');
  }
}

export function statsJson(sitio: string): Promise<unknown> {
  validarNombre(sitio);
  return comoJson(['container-stats', '-n', sitio, '--json', ...configArg()]);
}

export function inspectJson(sitio: string): Promise<unknown> {
  validarNombre(sitio);
  return comoJson(['container-inspect', '-n', sitio, '--json', ...configArg()]);
}

export function eventosJson(sitio: string): Promise<unknown> {
  validarNombre(sitio);
  return comoJson(['container-events', '-n', sitio, '--json', ...configArg()]);
}

export function diagnoseJson(sitio: string): Promise<unknown> {
  validarNombre(sitio);
  return comoJson(['diagnose', '-n', sitio, '--json', ...configArg()]);
}

export function dbStatsJson(sitio: string): Promise<unknown> {
  validarNombre(sitio);
  return comoJson(['db-stats', '-n', sitio, '--json', ...configArg()]);
}

export function auditoria(): Promise<string> {
  return correr(['audit', ...configArg()]);
}
