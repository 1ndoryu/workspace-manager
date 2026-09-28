/* Binario de limpiador-pc: resolucion versionada con auto-reconstruccion.
 * [por que] El binario NO vive en C:\tmp (se purga) ni se commitea: reside en
 * `data/bin/` (gitignored, pocos MB) y el server lo reconstruye solo cuando la
 * version del binario difiere de la del `Cargo.toml` de limpiador-pc. Asi una
 * actualizacion del limpiador se propaga sola al proximo analisis; el roadmap
 * documenta el flujo manual para quien quiera forzarlo. La compilacion usa
 * CARGO_TARGET_DIR en C:\tmp (regla del area) y copia solo el .exe final. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_AREA } from '../http.js';

const execFileAsync = promisify(execFile);

export const DIR_LIMPIADOR = join(RAIZ_AREA, 'limpiador-pc');
export const BIN_PC =
  process.env.LIMPIADOR_BIN || join(RAIZ_AREA, 'workspace-manager', 'data', 'bin', 'limpiador-pc.exe');
/* Target de compilacion: temporal por regla del area (se puede purgar; el
 * binario final ya copiado en data/bin sigue funcionando). */
export const TARGET_PC = 'C:\\tmp\\limpiador-pc-target';

export interface EstadoBinario {
  existe: boolean;
  versionBinario: string | null;
  versionFuente: string | null;
  actualizado: boolean;
  reconstruyendo: boolean;
}

/* Version declarada en limpiador-pc/Cargo.toml. null si no se puede leer. */
export function versionFuente(): string | null {
  try {
    const texto = readFileSync(join(DIR_LIMPIADOR, 'Cargo.toml'), 'utf8');
    const m = texto.match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/* Version que reporta el binario (`--version` => "limpiador-pc 0.1.0"). */
async function versionBinaria(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    const m = String(stdout).match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

let vueloReconstruccion: Promise<string> | null = null;

export function enReconstruccion(): boolean {
  return vueloReconstruccion !== null;
}

/* Estado sin construir nada: solo compara binario vs fuente. */
export async function estadoBinario(): Promise<EstadoBinario> {
  const fuente = versionFuente();
  if (!existsSync(BIN_PC)) {
    return { existe: false, versionBinario: null, versionFuente: fuente, actualizado: false, reconstruyendo: enReconstruccion() };
  }
  const vb = await versionBinaria(BIN_PC);
  return {
    existe: true,
    versionBinario: vb,
    versionFuente: fuente,
    actualizado: vb !== null && fuente !== null && vb === fuente,
    reconstruyendo: enReconstruccion(),
  };
}

/* Reconstruye el binario con cargo (target en C:\tmp) y lo copia a data/bin.
 * Single-flight: llamadores concurrentes esperan el mismo vuelo. */
export function reconstruirBinario(): Promise<string> {
  if (vueloReconstruccion) return vueloReconstruccion;
  vueloReconstruccion = (async () => {
    mkdirSync(join(RAIZ_AREA, 'workspace-manager', 'data', 'bin'), { recursive: true });
    await execFileAsync(
      'cargo',
      ['build', '--release', '--manifest-path', join(DIR_LIMPIADOR, 'Cargo.toml')],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 600000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, CARGO_TARGET_DIR: TARGET_PC },
      },
    );
    copyFileSync(join(TARGET_PC, 'release', 'limpiador-pc.exe'), BIN_PC);
    return BIN_PC;
  })();
  const vuelo = vueloReconstruccion;
  void vuelo.then(
    () => {
      if (vueloReconstruccion === vuelo) vueloReconstruccion = null;
    },
    () => {
      if (vueloReconstruccion === vuelo) vueloReconstruccion = null;
    },
  );
  return vuelo;
}

/* Ruta del binario listo: si falta o esta desactualizado, reconstruye. */
export async function asegurarBinario(): Promise<{ bin: string; version: string | null }> {
  const est = await estadoBinario();
  if (est.existe && est.actualizado) return { bin: BIN_PC, version: est.versionBinario };
  await reconstruirBinario();
  const vb = await versionBinaria(BIN_PC);
  return { bin: BIN_PC, version: vb };
}
