/* Binario del papel `limpiador`: resolucion versionada con auto-reconstruccion.
 * [por que] El binario NO vive en C:\tmp (se purga) ni se commitea: reside en
 * `data/bin/` (gitignored, pocos MB) y el server lo reconstruye solo cuando la
 * fuente cambia. Asi una mejora del limpiador se propaga sola al proximo
 * analisis; el roadmap documenta el flujo manual para quien quiera forzarlo.
 *
 * [16AA-1] La compilacion NO ocurre en el laptop: `scripts/build-windows.mjs`
 * del repo del limpiador se ejecuta desde aqui, pero solo orquesta: envia la
 * fuente por ssh a la VPS 89, compila alli (cargo-xwin) y trae el .exe de
 * vuelta. Antes se compilaba aqui con el MSVC local (vswhere + link.exe), lo que
 * dejaba un `target/` en C:\tmp y ataba el build a que hubiera Visual Studio.
 * Como el limpiador es Windows-only, la deteccion de cambios ya no puede ser
 * solo la version del `Cargo.toml`: mejoras sin subir version no se veian. Se
 * guarda una huella del codigo junto al binario y se compara. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { RAIZ_AREA, RAIZ_REPO } from '../plataforma/rutas.js';
import { avisoSinPapel, papelDeArea } from '../plataforma/area.js';
import { PUERTO_PROCESOS } from '../plataforma/sistema/procesos.js';
import type { PuertoProcesos } from '../plataforma/sistema/procesos.js';

/* El limpiador es un proyecto NUESTRO (otro repo del area), asi que su nombre
 * sale de la config (`config/area.json`). [por que] Estaba incrustado: en un
 * area con otro limpiador —o sin ninguno— esta pestaña apuntaba a la nada. */
const ROL_LIMPIADOR = papelDeArea('limpiador');
/* Sin papel declarado no hay fuente que compilar: se deja en null y los puntos
 * de entrada lo dicen. Nunca se resuelve a una ruta relativa, que seria peor
 * que no tenerla (leeria un Cargo.toml del cwd). */
const DIR_LIMPIADOR = ROL_LIMPIADOR ? join(RAIZ_AREA, ROL_LIMPIADOR) : null;
/* [por que] `data/` es de ESTE repo, asi que se pide desde RAIZ_REPO y no como
 * `<area>/workspace-manager/data`: el nombre del proyecto estaba incrustado y
 * la ruta solo valia si el area era la carpeta padre del repo. */
export const BIN_PC =
  process.env.LIMPIADOR_BIN || join(RAIZ_REPO, 'data', 'bin', `${ROL_LIMPIADOR ?? 'limpiador'}.exe`);
/* Huella de la fuente que produjo el binario actual. Si falta (binario de antes
 * de este flujo) `actualizado` es false y se reconstruye una vez. */
const HUELLA_PC = join(dirname(BIN_PC), `${ROL_LIMPIADOR ?? 'limpiador'}.huella.json`);
/* Tiempo maximo del build remoto: incluye envio de fuente + cargo-xwin en la 89. */
const TIMEOUT_MS = 600000;

export interface EstadoBinario {
  existe: boolean;
  versionBinario: string | null;
  versionFuente: string | null;
  actualizado: boolean;
  reconstruyendo: boolean;
}

/* Version declarada en el Cargo.toml del papel `limpiador`. null si no se puede leer. */
export function versionFuente(): string | null {
  if (!DIR_LIMPIADOR) return null;
  try {
    const texto = readFileSync(join(DIR_LIMPIADOR, 'Cargo.toml'), 'utf8');
    const m = texto.match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/* Version que reporta el binario (`--version` => "<nombre> <version>"). */
async function versionBinaria(bin: string, puerto: PuertoProcesos = PUERTO_PROCESOS): Promise<string | null> {
  try {
    const { stdout } = await puerto.ejecutar(bin, ['--version'], { windowsHide: true, timeout: 15000 });
    const m = stdout.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/* Ficheros que definen el binario: manifiesto, lock y todo el codigo Rust. */
function archivosFuente(): string[] {
  if (!DIR_LIMPIADOR) return [];
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const p = join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (e.name.endsWith('.rs')) salida.push(p);
    }
  };
  recorrer(join(DIR_LIMPIADOR, 'src'));
  return salida.sort();
}

/* Huella del codigo que produce el binario: rutas + contenido, en orden estable.
 * [por que] El CRLF se normaliza: el repo tiene `core.autocrlf=true`, asi que
 * un `git checkout` reescribe los .rs a CRLF sin cambiar el codigo. Sin
 * normalizar, cualquier operacion de git disparaba una recompilacion entera.
 * null si la fuente no es legible (entonces no se puede afirmar que este al dia). */
export function huellaFuente(): string | null {
  if (!DIR_LIMPIADOR) return null;
  try {
    const h = createHash('sha256');
    const ficheros = [
      join(DIR_LIMPIADOR, 'Cargo.toml'),
      join(DIR_LIMPIADOR, 'Cargo.lock'),
      ...archivosFuente(),
    ];
    for (const f of ficheros) {
      h.update(relative(DIR_LIMPIADOR, f).replace(/\\/g, '/'));
      h.update('\0');
      h.update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
      h.update('\0');
    }
    return h.digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/* Huella anotada tras el ultimo build. null si aun no hay ninguna. */
function huellaGuardada(): string | null {
  try {
    const j = JSON.parse(readFileSync(HUELLA_PC, 'utf8')) as { huella?: string };
    return typeof j.huella === 'string' ? j.huella : null;
  } catch {
    return null;
  }
}

let vueloReconstruccion: Promise<string> | null = null;

export function enReconstruccion(): boolean {
  return vueloReconstruccion !== null;
}

/* Estado sin construir nada: compara binario y fuente (version y codigo). */
export async function estadoBinario(): Promise<EstadoBinario> {
  const fuente = versionFuente();
  if (!existsSync(BIN_PC)) {
    return { existe: false, versionBinario: null, versionFuente: fuente, actualizado: false, reconstruyendo: enReconstruccion() };
  }
  const vb = await versionBinaria(BIN_PC);
  const huella = huellaFuente();
  return {
    existe: true,
    versionBinario: vb,
    versionFuente: fuente,
    actualizado:
      vb !== null && fuente !== null && vb === fuente && huella !== null && huella === huellaGuardada(),
    reconstruyendo: enReconstruccion(),
  };
}

/* Reconstruye el binario en la 89 y lo deja en data/bin. Single-flight:
 * llamadores concurrentes esperan el mismo vuelo. */
export function reconstruirBinario(puerto: PuertoProcesos = PUERTO_PROCESOS): Promise<string> {
  if (vueloReconstruccion) return vueloReconstruccion;
  vueloReconstruccion = (async () => {
    if (!DIR_LIMPIADOR) throw new Error(avisoSinPapel('limpiador'));
    const guion = join(DIR_LIMPIADOR, 'scripts', 'build-windows.mjs');
    /* Se ejecuta con el node actual, no con `node` del PATH: el server puede
     * arrancar sin el PATH del usuario. */
    await puerto.ejecutar(process.execPath, [guion, '--salida', BIN_PC], {
      windowsHide: true,
      timeout: TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    const huella = huellaFuente();
    if (huella === null) throw new Error(`no se pudo calcular la huella de ${ROL_LIMPIADOR} tras compilar`);
    writeFileSync(HUELLA_PC, `${JSON.stringify({ huella, version: versionFuente() }, null, 2)}\n`);
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
