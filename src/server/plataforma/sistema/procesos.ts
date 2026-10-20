/* Puerto de procesos (DIP): los consumidores ejecutan binarios a través de esta
 * interfaz y no importan `execFile` directamente.
 * [por que] Así los tests inyectan un puerto falso sin lanzar nada real, y la
 * implementación por defecto (`PUERTO_PROCESOS`) sigue siendo execFile sin shell. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface SalidaProceso {
  stdout: string;
  stderr: string;
}

/* Subconjunto de opciones que usan los consumidores. Sin `encoding`: el puerto
 * siempre devuelve texto UTF-8, así no hay Buffers que parsear a mano. */
export interface OpcionesProceso {
  timeout?: number;
  maxBuffer?: number;
  windowsHide?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface PuertoProcesos {
  /* Rechaza como execFile: con exit != 0 el error trae `stdout`/`stderr`, y los
   * llamadores que aprovechan salidas parciales deben leerlas del error. */
  ejecutar(bin: string, args: string[], opciones?: OpcionesProceso): Promise<SalidaProceso>;
}

const execFileAsync = promisify(execFile);

export const PUERTO_PROCESOS: PuertoProcesos = {
  async ejecutar(bin, args, opciones = {}) {
    const { stdout, stderr } = await execFileAsync(bin, args, { ...opciones, encoding: 'utf8' });
    return { stdout, stderr };
  },
};
