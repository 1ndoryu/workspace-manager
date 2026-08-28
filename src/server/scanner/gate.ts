/* Estado del gate por proyecto: Sentinel / VarSense / cargo.
 * [por que] No todos los proyectos declaran el mismo gate: GLORYPORT usa
 * cargo fmt/clippy/test sin sentinel.lock; WANDORIUS/PROYECTO TASKS declaran
 * sentinel + varsense. El manager trata el gate por proyecto, no asume uniformidad. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { EstadoGate } from '../../shared/types.js';

/** Detecta la config del gate en la raiz del proyecto. */
export function estadoGate(ruta: string): EstadoGate {
  const sentinelLock = existsSync(join(ruta, 'sentinel.lock.json'));
  const sentinelConfig = existsSync(join(ruta, 'sentinel.config.json'));
  const qualityTools = existsSync(join(ruta, 'quality-tools.json'));
  const varsenseConfig = existsSync(join(ruta, 'varsense.config.json'));
  const cargo = existsSync(join(ruta, 'Cargo.toml'));

  const sentinel = sentinelConfig ? 'config' : sentinelLock ? 'lock' : 'none';

  /* La puerta real del gate: si hay sentinel, sentinel; si no y hay cargo, cargo. */
  let puerta: EstadoGate['puerta'] = 'none';
  if (sentinel !== 'none' || qualityTools) puerta = 'sentinel';
  else if (cargo) puerta = 'cargo';

  return {
    declarado: sentinel !== 'none' || qualityTools || varsenseConfig,
    sentinel,
    varsense: varsenseConfig,
    doctor: null, /* doctor bajo demanda (pesado): se rellena en el detalle */
    gateDisponible: puerta !== 'none',
    puerta,
  };
}

/** Ejecuta `sentinel doctor` resumido (bajo demanda, no en el escaneo inicial). */
export function doctorSentinel(ruta: string): string | null {
  try {
    /* [por que] `sentinel` en Windows es un shim .cmd: execFileSync no ejecuta
     * .cmd/.bat sin shell=true, devolvia siempre null ("sin salida").
     * [seguridad] shell=true concatena args sin escapar (warning DEP0190); en
     * su lugar resolvemos el shim a su comando real (cmd /c) con args aparte,
     * sin pasar por un string de shell. */
    if (process.platform === 'win32') {
      const out = execFileSync('cmd', ['/d', '/s', '/c', 'sentinel', 'doctor', '--json', '--workspace', ruta], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
        windowsHide: true,
      });
      return out.trim().slice(0, 2000);
    }
    const out = execFileSync('sentinel', ['doctor', '--json', '--workspace', ruta], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return out.trim().slice(0, 2000);
  } catch {
    return null;
  }
}

/** Lee sentinel.lock.json de forma segura (manifest de herramientas). */
export function leerSentinelLock(ruta: string): Record<string, unknown> | null {
  const lock = join(ruta, 'sentinel.lock.json');
  if (!existsSync(lock)) return null;
  try {
    return JSON.parse(readFileSync(lock, 'utf8'));
  } catch {
    return null;
  }
}
