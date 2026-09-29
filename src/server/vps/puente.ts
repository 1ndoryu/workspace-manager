/* Puente con coolify-manager-rs para la tab vps (299A-5).
 * [por que] El binario vive fuera de C:\tmp (se purga cada hora):
 * COOLIFY_MANAGER_BIN o C:\Users\Owner\bin\coolify-manager.exe (durable) con
 * fallback a C:\tmp\bin (legacy). Cada consulta es un proceso execFile SIN
 * shell y con argv construido aqui: la allowlist no es una lista de strings
 * sino el conjunto cerrado de funciones de abajo (solo lectura; no existe
 * ninguna que acepte --repair/--alert ni comandos arbitrarios). Concurrencia
 * 1 (cola) para no apilar SSH/API contra la VPS, timeout 90 s, salida
 * acotada, secretos redactados antes de devolver nada. */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

const BIN_DURADERO = 'C:\\Users\\Owner\\bin\\coolify-manager.exe';
const BIN_LEGACY = 'C:\\tmp\\bin\\coolify-manager.exe';
const TIMEOUT_MS = 90_000;
const MAX_SALIDA = 512 * 1024;

const NOMBRE_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function rutaBinario(): string | null {
  const porEnv = (process.env.COOLIFY_MANAGER_BIN ?? '').trim();
  if (porEnv && existsSync(porEnv)) return porEnv;
  if (existsSync(BIN_DURADERO)) return BIN_DURADERO;
  if (existsSync(BIN_LEGACY)) return BIN_LEGACY;
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

/* Redacta pares evidentes de secretos en texto humano (logs/health pueden
 * arrastrarlos). Dominios y UUIDs se conservan: no son secretos. */
export function redactar(texto: string): string {
  return texto.replace(
    /(api[_-]?key|token|password|passwd|secret)\s*[:=]\s*(\S+)/gi,
    '$1=···',
  );
}

function configArg(): string[] {
  const ruta = (process.env.COOLIFY_MANAGER_CONFIG ?? '').trim();
  return ruta && existsSync(ruta) ? ['-c', ruta] : [];
}

function validarNombre(sitio: string): void {
  if (!NOMBRE_OK.test(sitio)) throw new Error(`nombre-invalido: ${sitio}`);
}

async function correr(argv: string[]): Promise<string> {
  const bin = rutaBinario();
  if (!bin) throw new Error('sin-binario');
  return encolar(
    () =>
      new Promise<string>((resolver, rechazar) => {
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
      }),
  );
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
  return correr(['list', ...(detallado ? ['--detailed'] : []), ...configArg()]);
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
