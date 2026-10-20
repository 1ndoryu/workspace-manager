/* Argumentos y parseo de salida de los runtimes de análisis: funciones puras, sin procesos
 * ni sistema de archivos. [por que] Separadas de `ejecucion.ts` (límite de 300 líneas) para
 * que lo que se construye y se lee se pruebe sin lanzar sentinel ni varsense. */
import type { ReporteJson, ResultadoSpawn } from './tipos.js';

/* [por que] Argumentos como array, nunca como cadena de shell: sin shell no hay nada que escapar. */
export function argsAnalisisSentinel(cli: string, ruta: string): string[] {
  return [cli, 'analyze', '--workspace', ruta, '--format', 'json'];
}

export function argsDoctor(cli: string, ruta: string): string[] {
  return [cli, 'doctor', '--json', '--workspace', ruta];
}

export function argsVarsense(cli: string, ruta: string): string[] {
  return [cli, 'all', '--workspace', ruta, '--format', 'json'];
}

/* Parseo tolerante del reporte JSON: solo es un reporte válido si hay un
 * objeto parseable en stdout. [por que] comparte la lógica entre la rama de
 * éxito y la de exit != 0 (ver correrSentinel). */
export function parsearReporte(stdout: string | undefined): ReporteJson | null {
  if (typeof stdout !== 'string' || !stdout) return null;
  try {
    const dato = JSON.parse(stdout) as ReporteJson;
    return dato && typeof dato === 'object' ? dato : null;
  } catch {
    return null;
  }
}

/* Resultado del análisis a partir de su stdout (o del `err.stdout` si salió con exit != 0). */
export function resultadoDeSalida(
  stdout: string | undefined,
  version: string,
  commit: string | null,
): ResultadoSpawn | null {
  const dato = parsearReporte(stdout);
  return dato ? { version, commit, dato } : null;
}

/* Salida de `doctor` acotada; vacía = null. */
export function salidaDoctor(stdout: string): string | null {
  return stdout.trim().slice(0, 2000) || null;
}

/* [por que] doctor sale con 1 cuando hay issues (p. ej. evidencia de release
 * ausente) y su JSON sigue siendo el diagnóstico: se aprovecha stdout. Si lo
 * mató el timeout, el stdout es parcial y no es JSON válido. */
export function salidaDoctorDeError(e: { stdout?: string; signal?: string | null }): string | null {
  if (e.signal) return null;
  return e.stdout ? salidaDoctor(e.stdout) : null;
}
