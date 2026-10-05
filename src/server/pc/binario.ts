/* Binario de limpiador-pc: resolucion versionada con auto-reconstruccion.
 * [por que] El binario NO vive en C:\tmp (se purga) ni se commitea: reside en
 * `data/bin/` (gitignored, pocos MB) y el server lo reconstruye solo cuando la
 * version del binario difiere de la del `Cargo.toml` de limpiador-pc. Asi una
 * actualizacion del limpiador se propaga sola al proximo analisis; el roadmap
 * documenta el flujo manual para quien quiera forzarlo. La compilacion usa
 * CARGO_TARGET_DIR en C:\tmp (regla del area) y copia solo el .exe final. */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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

/* Toolchain REAL para el hijo de compilacion, resuelto una vez y cacheado.
 * [por que] El backend debe invocar el cargo real, nunca el shim de
 * GlorySentinel (bloquea con exit 100 fuera del gate) ni depender del orden
 * del PATH heredado: el `spawn cargo ENOENT` del 2026-10-04 vino de un server
 * sin toolchain a la vista. `link.exe` vive en ruta versionada (rota con cada
 * update de VS): se resuelve via vswhere, nunca fijada a mano. */
function dirsToolchain(): string[] {
  const home = process.env.USERPROFILE ?? '';
  const cargoBin = join(home, '.cargo', 'bin');
  const dirs = existsSync(join(cargoBin, 'cargo.exe')) ? [cargoBin] : [];
  const msvc = resolverMsvc();
  if (msvc) dirs.push(msvc);
  return dirs;
}

/* Localiza `.../VC/Tools/MSVC/<ver>/bin/Hostx64/x64` (la mayor version).
 * null si no hay VS con C++ instalado: el hijo fallara con su propio error. */
function resolverMsvc(): string | null {
  const candidatos: string[] = [];
  try {
    const vswhere = join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe',
    );
    if (existsSync(vswhere)) {
      const inst = execFileSync(
        vswhere,
        ['-latest', '-prerelease', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 },
      )
        .trim()
        .split(/\r?\n/, 1)[0];
      if (inst) candidatos.push(join(inst, 'VC', 'Tools', 'MSVC'));
    }
  } catch {
    /* sin vswhere o sin componente C++: se intenta el glob de abajo */
  }
  candidatos.push('C:\\Program Files\\Microsoft Visual Studio');
  for (const base of candidatos) {
    const mejor = mejorMsvcBajo(base);
    if (mejor) return mejor;
  }
  return null;
}

/* Mayor `<base>[/<edicion>]/VC/Tools/MSVC/<ver>/bin/Hostx64/x64` existente. */
function mejorMsvcBajo(base: string): string | null {
  let ediciones: string[];
  try {
    ediciones = base.endsWith('MSVC') ? [''] : readdirSync(base);
  } catch {
    return null;
  }
  const duenos =
    base.endsWith('MSVC') ? [base] : ediciones.flatMap((ed) => {
      const raizEd = join(base, ed);
      const vars = [join(raizEd, 'VC', 'Tools', 'MSVC')];
      /* ediciones con canal (`...\18\Insiders\VC\...`): un nivel mas */
      try {
        for (const sub of readdirSync(raizEd)) vars.push(join(raizEd, sub, 'VC', 'Tools', 'MSVC'));
      } catch {
        /* sin permiso o no es dir: solo el directo */
      }
      return vars.filter((v) => existsSync(v));
    });
  for (const dueno of duenos) {
    let versiones: string[];
    try {
      versiones = readdirSync(dueno);
    } catch {
      continue;
    }
    for (const ver of versiones.sort().reverse()) {
      const bin = join(dueno, ver, 'bin', 'Hostx64', 'x64');
      if (existsSync(join(bin, 'link.exe'))) return bin;
    }
  }
  return null;
}

const DIRS_TOOLCHAIN = dirsToolchain();
/* cargo REAL (ruta absoluta si existe; si no, `cargo` del PATH y que el hijo
 * reporte su propio error). Nunca el shim: se evita por ruta, no por orden. */
const CARGO_REAL =
  DIRS_TOOLCHAIN.length > 0 ? join(DIRS_TOOLCHAIN[0], 'cargo.exe') : 'cargo';

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
      CARGO_REAL,
      ['build', '--release', '--manifest-path', join(DIR_LIMPIADOR, 'Cargo.toml')],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 600000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          CARGO_TARGET_DIR: TARGET_PC,
          /* rustc necesita link.exe a la vista aunque cargo vaya por ruta */
          PATH: [...DIRS_TOOLCHAIN, process.env.PATH ?? ''].filter((p) => p !== '').join(';'),
        },
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
