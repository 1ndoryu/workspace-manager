/* Probe del Guardián (10AA-2 F11.4, sección «Probar»): pregunta a Sentinel qué
 * decidiría para un comando en un proyecto, SIN ejecutarlo.
 * [por que] La decisión la toma el mismo `current.js guard` que usan los shims, así
 * la pestaña no reimplementa la matriz de bloqueo. Se llama con execFile (sin shell,
 * argumentos en array) y con un timeout corto. GLORY_GUARD_LOG_DIR va a un
 * directorio de C:/tmp para que las pruebas no ensucien el diario real que lee
 * «Actividad». Se quitan GLORY_QUALITY_GATE_LEASE y GLORY_QUALITY_GATE_TOKEN: una
 * prueba no hereda ni emite leases. */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ErrorValidacion, type Listas } from '../configuracion/politica.js';
import { raizTemporales } from '../../plataforma/sistema/temporales.js';

const execFileAsync = promisify(execFile);

export const TIEMPO_PROBAR_MS = 5000;
const SALIDA_MAX = 256 * 1024;
const CODIGO_BLOQUEO = 78;
const PATRON_EJECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const MAX_ARGS = 64;
const MAX_LONGITUD_ARG = 512;
/* [por que] Antes era 'C:/tmp/...' literal: en Linux es una ruta relativa al cwd del servidor.
 * El nombre es del manager, no de Sentinel: sus pruebas no deben escribir en el diario de
 * `glory-quality-guard`. La barra fija (no path.join) mantiene el valor de Windows byte a byte. */
export const DIARIO_PRUEBAS = `${raizTemporales()}/wm-guardian-probe`;

export interface EntradaProbar {
  raiz: string;
  ejecutable: string;
  args: string[];
}

export interface OpcionesProbar {
  /* Rutas inyectables: en producción se resuelven solas; los tests usan un runtime falso. */
  runtimeJs?: string;
  diarioDir?: string;
  timeoutMs?: number;
  entorno?: NodeJS.ProcessEnv;
}

/* Campos de la decisión que la pestaña muestra. Se copian uno a uno: no se reenvía
 * el JSON de Sentinel tal cual. */
export interface DecisionProbada {
  blocked: boolean;
  mode?: string;
  action?: string;
  observed?: boolean | string;
  reason?: string;
  category?: string | null;
  policyStatus?: string;
  alternativa?: string;
}

export type ResultadoProbar =
  | { estado: 'ok'; codigo: number; decision: DecisionProbada }
  | { estado: 'error'; motivo: string };

/* [por que] El probe solo consulta a Sentinel por lo que el Guardián tiene registrado en
 * el proyecto: sus `tools` y los ejecutables que cubren sus listas de npm, npx y cargo.
 * Así la API no sirve para sondear binarios arbitrarios del sistema. */
export function herramientasRegistradas(listas: Listas): Set<string> {
  const registro = new Set(listas.tools);
  if (listas.npmScripts.length > 0) registro.add('npm');
  if (listas.npxTools.length > 0) registro.add('npx');
  if (listas.cargoSubcommands.length > 0) registro.add('cargo');
  return registro;
}

export function comprobarRegistrada(ejecutable: string, listas: Listas): void {
  if (!herramientasRegistradas(listas).has(ejecutable)) {
    throw new ErrorValidacion(`«${ejecutable}» no está en el registro del Guardián de este proyecto`);
  }
}

export function runtimeJsPorDefecto(): string {
  const local = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');
  return path.join(local, 'GlorySentinel', 'current.js');
}

function validarEntrada(entrada: EntradaProbar): void {
  if (typeof entrada.raiz !== 'string' || !path.isAbsolute(entrada.raiz)) {
    throw new ErrorValidacion('la raíz del proyecto debe ser una ruta absoluta');
  }
  if (typeof entrada.ejecutable !== 'string' || !PATRON_EJECUTABLE.test(entrada.ejecutable)) {
    throw new ErrorValidacion('ejecutable no válido: usa solo el nombre (p. ej. npm o cargo)');
  }
  if (!Array.isArray(entrada.args) || entrada.args.length > MAX_ARGS) {
    throw new ErrorValidacion(`args debe ser una lista de hasta ${MAX_ARGS} elementos`);
  }
  for (const arg of entrada.args) {
    if (typeof arg !== 'string' || arg.length > MAX_LONGITUD_ARG || arg.includes('\0')) {
      throw new ErrorValidacion('cada argumento debe ser texto de hasta 512 caracteres, sin NUL');
    }
  }
}

function copiarTexto(d: Record<string, unknown>, campo: string): string | undefined {
  return typeof d[campo] === 'string' ? (d[campo] as string) : undefined;
}

/* Interpreta la salida de `guard --json`. Un código y una decisión que no cuadran
 * (p. ej. 78 con blocked:false) son error: no se presenta una decisión dudosa como válida. */
function interpretar(codigo: number, salida: string): ResultadoProbar {
  let valor: unknown;
  try {
    valor = JSON.parse(salida) as unknown;
  } catch {
    return { estado: 'error', motivo: 'la salida de Sentinel no es JSON' };
  }
  if (!valor || typeof valor !== 'object' || typeof (valor as { blocked?: unknown }).blocked !== 'boolean') {
    return { estado: 'error', motivo: 'la decisión de Sentinel no trae el campo blocked' };
  }
  const d = valor as Record<string, unknown>;
  const bloquea = d.blocked as boolean;
  if (bloquea !== (codigo !== 0)) {
    return { estado: 'error', motivo: 'el código de salida y la decisión no coinciden' };
  }
  const decision: DecisionProbada = { blocked: bloquea };
  for (const campo of ['mode', 'action', 'reason', 'policyStatus', 'alternativa'] as const) {
    const texto = copiarTexto(d, campo);
    if (texto !== undefined) decision[campo] = texto;
  }
  if (typeof d.category === 'string' || d.category === null) decision.category = d.category;
  if (typeof d.observed === 'boolean' || typeof d.observed === 'string') decision.observed = d.observed;
  return { estado: 'ok', codigo, decision };
}

/* Pregunta a Sentinel la decisión para `ejecutable args` en `raiz`. No ejecuta el
 * comando: el guard solo decide y registra. Lanza ErrorValidacion si la entrada es
 * inválida; cualquier fallo de Sentinel (timeout, salida rota) vuelve como estado error. */
export async function probarComando(entrada: EntradaProbar, opciones: OpcionesProbar = {}): Promise<ResultadoProbar> {
  validarEntrada(entrada);
  const entorno: NodeJS.ProcessEnv = { ...(opciones.entorno ?? process.env) };
  delete entorno.GLORY_QUALITY_GATE_LEASE;
  delete entorno.GLORY_QUALITY_GATE_TOKEN;
  entorno.GLORY_GUARD_LOG_DIR = opciones.diarioDir ?? DIARIO_PRUEBAS;
  /* [por que] Va al portátil y no a la 89 (AGENTS §1, excepción de decisión): el guard decide
   * con el Guardián que los shims del portátil consultan y con rutas del portátil (`raiz`), así
   * que la respuesta de la 89 sería de otra instalación. Es una decisión de milisegundos, no un
   * análisis ni una compilación. Sin Sentinel instalado devuelve estado error con el motivo. */
  const argv = [
    opciones.runtimeJs ?? runtimeJsPorDefecto(),
    'guard',
    '--json',
    '--executable',
    entrada.ejecutable,
    '--project-root',
    entrada.raiz,
    '--',
    ...entrada.args,
  ];
  try {
    const { stdout } = await execFileAsync(process.execPath, argv, {
      cwd: entrada.raiz,
      env: entorno,
      timeout: opciones.timeoutMs ?? TIEMPO_PROBAR_MS,
      maxBuffer: SALIDA_MAX,
      windowsHide: true,
    });
    return interpretar(0, String(stdout));
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string | null; code?: unknown; stdout?: unknown };
    if (e.killed || e.signal === 'SIGTERM') return { estado: 'error', motivo: 'Sentinel no respondió a tiempo' };
    /* Bloquear es un resultado válido: sale con 78 y el JSON va en stdout. */
    if (e.code === CODIGO_BLOQUEO) return interpretar(CODIGO_BLOQUEO, String(e.stdout ?? ''));
    if (typeof e.code === 'number') return { estado: 'error', motivo: `Sentinel terminó con código ${e.code}` };
    return { estado: 'error', motivo: 'no se pudo ejecutar Sentinel' };
  }
}
