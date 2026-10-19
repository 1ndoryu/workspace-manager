/* Mantenimiento del Guardián (10AA-2 F11.4, sección «Mantenimiento»): actualiza la
 * instalación de Sentinel desde su checkout con `sentinel update`.
 * [por que] Sin `confirmar` siempre es dry-run: el tablero enseña qué cambiaría antes
 * de tocar nada. Los shims y los perfiles de shell solo se escriben con confirmación y
 * por opción explícita. El PATH de usuario (`--with-path`) no se expone desde el
 * tablero: es una modificación del entorno del usuario que se hace a mano. */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { ErrorValidacion } from '../configuracion/politica.js';
import { runtimeJsPorDefecto } from './probar.js';

const execFileAsync = promisify(execFile);

export const TIEMPO_MANTENIMIENTO_MS = 60_000;
export const LIMITE_SALIDA = 8 * 1024;
const MAX_BUFFER = 256 * 1024;
const MAX_RUTA = 512;

export interface EntradaMantenimiento {
  sourceRoot?: string;
  targetRoot?: string;
  conShims?: boolean;
  conPerfiles?: boolean;
  confirmar?: boolean;
}

export interface OpcionesMantenimiento {
  /* Inyectables: en producción se resuelven solos; los tests usan un runtime falso. */
  runtimeJs?: string;
  timeoutMs?: number;
  entorno?: NodeJS.ProcessEnv;
}

export interface ResultadoMantenimiento {
  estado: 'ok' | 'error';
  modo: 'simulacion' | 'aplicado';
  codigo: number | null;
  motivo?: string;
  salida: string;
}

interface Normalizada {
  sourceRoot?: string;
  targetRoot?: string;
  conShims: boolean;
  conPerfiles: boolean;
  confirmar: boolean;
}

/* [por que] Dos `update` sobre el mismo target se pisan: solo uno a la vez. */
let enCurso = false;

function validarRuta(valor: unknown, campo: string): string | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'string' || !path.isAbsolute(valor) || valor.length > MAX_RUTA || valor.includes('\0')) {
    throw new ErrorValidacion(`${campo} debe ser una ruta absoluta de hasta ${MAX_RUTA} caracteres`);
  }
  return valor;
}

function validarBooleano(valor: unknown, campo: string): boolean {
  if (valor === undefined) return false;
  if (typeof valor !== 'boolean') throw new ErrorValidacion(`${campo} debe ser true o false`);
  return valor;
}

function normalizar(entrada: EntradaMantenimiento): Normalizada {
  const conShims = validarBooleano(entrada.conShims, 'conShims');
  const conPerfiles = validarBooleano(entrada.conPerfiles, 'conPerfiles');
  /* [por que] Un perfil que dot-sourcea shims sin shims escritos deja la shell rota. */
  if (conPerfiles && !conShims) {
    throw new ErrorValidacion('los perfiles apuntan a los shims: activa también conShims');
  }
  return {
    sourceRoot: validarRuta(entrada.sourceRoot, 'sourceRoot'),
    targetRoot: validarRuta(entrada.targetRoot, 'targetRoot'),
    conShims,
    conPerfiles,
    confirmar: validarBooleano(entrada.confirmar, 'confirmar'),
  };
}

function argumentos(n: Normalizada): string[] {
  const args = ['update'];
  if (n.sourceRoot) args.push('--source-root', n.sourceRoot);
  if (n.targetRoot) args.push('--target-root', n.targetRoot);
  if (n.conShims) args.push('--with-shims');
  if (n.conPerfiles) args.push('--with-profiles');
  /* Sin confirmar, Sentinel calcula el plan y no escribe nada. */
  if (!n.confirmar) args.push('--dry-run');
  return args;
}

function recortar(texto: string): string {
  return texto.length <= LIMITE_SALIDA ? texto : `${texto.slice(0, LIMITE_SALIDA)}\n… salida recortada`;
}

function juntar(stdout: unknown, stderr: unknown): string {
  return [String(stdout ?? ''), String(stderr ?? '')].filter((t) => t !== '').join('\n');
}

/* Ejecuta `sentinel update` con execFile (sin shell). Lanza ErrorValidacion si la
 * entrada no es válida; cualquier fallo de Sentinel vuelve como estado error con la
 * salida para diagnosticarlo. Si la actualización se corta a mitad, la instalación
 * puede quedar a medias: el motivo lo dice para que se compruebe antes de reintentar. */
export async function ejecutarMantenimiento(
  entrada: EntradaMantenimiento = {},
  opciones: OpcionesMantenimiento = {},
): Promise<ResultadoMantenimiento> {
  const n = normalizar(entrada);
  const modo = n.confirmar ? 'aplicado' : 'simulacion';
  if (enCurso) {
    return { estado: 'error', modo, codigo: null, motivo: 'ya hay una actualización de Sentinel en curso', salida: '' };
  }
  const entorno: NodeJS.ProcessEnv = { ...(opciones.entorno ?? process.env) };
  delete entorno.GLORY_QUALITY_GATE_LEASE;
  delete entorno.GLORY_QUALITY_GATE_TOKEN;
  enCurso = true;
  try {
    /* [por que] Este comando instala la herramienta Sentinel del portátil (runtime en
     * %LOCALAPPDATA%); no analiza ni compila proyectos, así que no pasa por la VPS 89 (AGENTS §1). */
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [opciones.runtimeJs ?? runtimeJsPorDefecto(), ...argumentos(n)],
      {
        env: entorno,
        timeout: opciones.timeoutMs ?? TIEMPO_MANTENIMIENTO_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      },
    );
    return { estado: 'ok', modo, codigo: 0, salida: recortar(juntar(stdout, stderr)) };
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string | null; code?: unknown; stdout?: unknown; stderr?: unknown };
    const salida = recortar(juntar(e.stdout, e.stderr));
    if (e.killed || e.signal === 'SIGTERM') {
      return {
        estado: 'error',
        modo,
        codigo: null,
        motivo: 'la actualización no terminó a tiempo; comprueba la instalación antes de reintentar',
        salida,
      };
    }
    if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return { estado: 'error', modo, codigo: null, motivo: 'la salida de Sentinel superó el límite', salida };
    }
    if (typeof e.code === 'number') {
      return { estado: 'error', modo, codigo: e.code, motivo: `Sentinel terminó con código ${e.code}`, salida };
    }
    return { estado: 'error', modo, codigo: null, motivo: 'no se pudo ejecutar Sentinel', salida };
  } finally {
    enCurso = false;
  }
}
