/* Elevación selectiva del limpiador-pc: reintentar como administrador solo
 * lo que falló por permisos fuera del perfil (p. ej. ProgramData).
 * [por que] El backend corre como usuario estándar y el .exe hereda su token
 * vía execFile sin shell: borrar bajo C:\ProgramData devuelve «os error 5»
 * aunque la entrada sea legítima. Elevar TODO (manifiesto) pediría UAC en
 * cada análisis; aquí solo el borrado que lo necesita muestra el diálogo
 * UAC, una vez por fase con fallos de permiso.
 *
 * Mecánica: Start-Process -Verb RunAs -Wait con salida redirigida a fichero
 * (el proceso elevado no puede devolver stdout por tubería al padre). Sin
 * shell en el padre: execFile directo a pwsh.exe con un -Command construido
 * solo con piezas validadas (binario y reporte del server + claves con
 * regex ^[a-z0-9_-]{1,40}$), citadas en comilla simple de PowerShell. */

import { execFile } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/* Verdadero si la ruta absoluta vive fuera del perfil del usuario (ámbito
 * de máquina: ProgramData, raíces protegidas...). Fail-closed: ante duda
 * (relativa, sin perfil, error) devuelve false y NO se eleva. */
export function esRutaAdmin(ruta: unknown): boolean {
  try {
    if (typeof ruta !== 'string' || ruta.trim() === '') return false;
    const perfil = process.env.USERPROFILE ?? process.env.HOME ?? '';
    if (perfil === '') return false;
    const norm = (s: string): string => s.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const r = norm(ruta);
    const p = norm(perfil);
    /* \\?\C:\... (verbatim del limpiador) y C:\... deben compararse igual. */
    const sinPrefijo = (s: string): string => (s.startsWith('\\\\?\\') ? s.slice(4) : s);
    const rn = sinPrefijo(r);
    const pn = sinPrefijo(p);
    if (!/^[a-z]:\\/.test(rn) || !/^[a-z]:\\/.test(pn)) return false;
    return !(rn === pn || rn.startsWith(`${pn}\\`));
  } catch {
    return false;
  }
}

/* El limpiador informa el permiso denegado en español («Acceso denegado»)
 * con el código del SO entre paréntesis. */
export function esFalloPermiso(detalle: unknown): boolean {
  if (typeof detalle !== 'string') return false;
  return /acceso denegado/i.test(detalle) || /os error 5\b/.test(detalle);
}

/* Cita PowerShell en comilla simple (duplicar la comilla). Las claves ya
 * vienen acotadas por regex en validarSeleccion; esto cubre binario y
 * reporte del lado servidor. */
function citarPs(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

export interface ResultadoElevado {
  salida: string;
}

/* Relanza el binario elevado (UAC) con los mismos argumentos, espera a que
 * termine y devuelve su stdout. Lanza Error si el usuario deniega el
 * diálogo UAC o si el elevado falla sin JSON aprovechable.
 * [por que] Sin -Wait el padre no sabría cuándo leer el fichero; sin
 * fichero no hay retorno (el hijo elevado no hereda tuberías útiles). Los
 * temporales viven en el dir del SO con nombre único y se retiran siempre. */
export async function ejecutarCleanElevado(bin: string, args: string[]): Promise<ResultadoElevado> {
  const sello = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const salidaPath = join(tmpdir(), `wm-pc-elev-${sello}.out.json`);
  const errorPath = join(tmpdir(), `wm-pc-elev-${sello}.err.txt`);
  const listaArgs = args.map(citarPs).join(',');
  const guion = [
    '$p = Start-Process',
    `-FilePath ${citarPs(bin)}`,
    `-ArgumentList ${listaArgs}`,
    '-Verb RunAs -Wait -PassThru',
    `-RedirectStandardOutput ${citarPs(salidaPath)}`,
    `-RedirectStandardError ${citarPs(errorPath)}`,
    '-WindowStyle Hidden',
    '; exit $p.ExitCode',
  ].join(' ');
  try {
    await execFileAsync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', guion], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 300000,
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; message?: unknown };
    const texto = `${String(e.stderr ?? '')} ${String(e.message ?? '')}`;
    /* Éxito parcial del hijo (exit 1 con JSON): se aprovecha igual que en
     * el camino sin elevar; cada fila trae su estado. */
    let parcial = '';
    try {
      parcial = readFileSync(salidaPath, 'utf8');
    } catch {
      parcial = '';
    } finally {
      rmSync(salidaPath, { force: true });
      rmSync(errorPath, { force: true });
    }
    if (parcial.trim() !== '') return { salida: parcial };
    if (/canceled by the user|denegad[oa]|0x800704C7/i.test(texto)) {
      throw new Error('elevación denegada en el diálogo de Windows (UAC): reintenta y acepta para borrar fuera del perfil');
    }
    throw new Error(`no se pudo lanzar el borrado como administrador: ${texto.slice(0, 300)}`);
  }
  let salida = '';
  try {
    salida = readFileSync(salidaPath, 'utf8');
  } finally {
    rmSync(salidaPath, { force: true });
    rmSync(errorPath, { force: true });
  }
  if (salida.trim() === '') throw new Error('el borrado elevado no devolvió resultado');
  return { salida };
}
