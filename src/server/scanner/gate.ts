/* Estado del gate por proyecto: Sentinel / VarSense / cargo.
 * [por que] No todos los proyectos declaran el mismo gate: GLORYPORT usa
 * cargo fmt/clippy/test sin sentinel.lock; WANDORIUS/PROYECTO TASKS declaran
 * sentinel + varsense. El manager trata el gate por proyecto, no asume uniformidad. */
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { EstadoGate, ProblemaGate } from '../../shared/types.js';
import { diagnosticar, rutaEtiqueta, severidadDe, type NodoEsquema } from '../../shared/gate/esquema.js';
import { ESQUEMA_SENTINEL } from '../../shared/gate/sentinel.js';
import { ESQUEMA_VARSENSE } from '../../shared/gate/varsense.js';

/* Hojas de estilo y configs de tailwind: lo que VarSense valida.
 * [por que] Sin ninguna, varsense no tiene nada que comprobar y no debe marcarse "ausente". */
const EXTENSION_ESTILOS = /\.(css|scss|sass|less|styl|pcss)$/i;
const CONFIG_TAILWIND = /^tailwind\.config\.(js|cjs|mjs|ts)$/i;
/* [por que] Acotado: el escaneo corre sobre todos los proyectos en cada snapshot.
 * Directorios que no son fuente, y ocultos, no aportan estilos propios. */
const DIRECTORIOS_IGNORADOS = new Set(['node_modules', 'target', 'dist', 'build', 'out', 'coverage']);
const PROFUNDIDAD_MAX = 6;
const ENTRADAS_MAX = 5000;

/* [por que] Si se agota la profundidad o el presupuesto de entradas, se asume que
 * hay estilos: no ocultar un "varsense ausente" real por no haber terminado de mirar. */
export function hayEstilos(ruta: string): boolean {
  let presupuesto = ENTRADAS_MAX;

  function recorrer(dir: string, profundidad: number): boolean {
    if (profundidad > PROFUNDIDAD_MAX) return true;
    let entradas: Dirent[];
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entrada of entradas) {
      if (--presupuesto < 0) return true;
      if (entrada.isDirectory()) {
        if (entrada.name.startsWith('.') || DIRECTORIOS_IGNORADOS.has(entrada.name)) continue;
        if (recorrer(join(dir, entrada.name), profundidad + 1)) return true;
      } else if (EXTENSION_ESTILOS.test(entrada.name) || CONFIG_TAILWIND.test(entrada.name)) {
        return true;
      }
    }
    return false;
  }

  return recorrer(ruta, 0);
}

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

  const declarado = sentinel !== 'none' || qualityTools || varsenseConfig;

  return {
    declarado,
    sentinel,
    varsense: varsenseConfig,
    /* Solo se escanea si la falta de varsense podria marcarse; evita E/S innecesaria. */
    sinEstilos: declarado && !varsenseConfig ? !hayEstilos(ruta) : false,
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
      windowsHide: true,
    });
    return out.trim().slice(0, 2000);
  } catch {
    return null;
  }
}

/* Nombres de archivos de gate editables por proyecto, en orden de
 * preferencia para mostrarse. [por que] El panel de configuracion por
 * proyecto edita la source of truth JSON (reglas sentinel/varsense); solo
 * estos nombres son escritura permitida (whitelist anti-traversal). */
export const ARCHIVOS_GATE = [
  'sentinel.config.json',
  'sentinel.lock.json',
  'quality-tools.json',
  'varsense.config.json',
] as const;

export type ArchivoGate = (typeof ARCHIVOS_GATE)[number];

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

/* Mensaje legible de una opcion diagnosticada para la consola.
 * [por que] La consola muestra por que falla: la opcion, el archivo y si falta
 * (obligatoria vs recomendada) o si el valor tiene el tipo incorrecto. */
function mensajeDeFila(archivo: string, ruta: string, estado: string): string {
  if (estado === 'faltaRequerida') return `${archivo} › ${ruta}: falta una opción obligatoria`;
  if (estado === 'faltaRecomendada') return `${archivo} › ${ruta}: falta una opción recomendada`;
  if (estado === 'desconocida') return `${archivo} › ${ruta}: clave desconocida (typo?)`;
  return `${archivo} › ${ruta}: valor con tipo incorrecto`;
}

/* Diagnostica la config del gate de un proyecto contra su esquema y devuelve
 * SOLO los problemas que la consola debe reportar (error/advertencia).
 * [por que] La consola se alimenta del snapshot; opciones opcionales que faltan
 * se silencian aqui (severidadDe -> null). No modifica los archivos (solo lectura). */
export function diagnosticarGate(rutaProyecto: string): ProblemaGate[] {
  const problemas: ProblemaGate[] = [];

  function correr(nombre: string, esquema: NodoEsquema): void {
    const rutaArchivo = join(rutaProyecto, nombre);
    if (!existsSync(rutaArchivo)) return;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(rutaArchivo, 'utf8'));
    } catch {
      /* JSON invalido: lo reporta el editor/parse; no lo marcamos aqui para no
       * duplicar con el motivo 'gate'. */
      return;
    }
    for (const fila of diagnosticar(esquema, json)) {
      const severidad = severidadDe(fila);
      if (!severidad) continue;
      const etiqueta = rutaEtiqueta(fila.ruta);
      let estado: string;
      if (fila.tipo === 'desconocida') estado = 'desconocida';
      else if (fila.tipo === 'campo') estado = 'malTipo';
      else estado = fila.necesidad === 'requerida' ? 'faltaRequerida' : 'faltaRecomendada';
      problemas.push({
        archivo: nombre,
        ruta: etiqueta,
        severidad,
        mensaje: mensajeDeFila(nombre, etiqueta, estado),
      });
    }
  }

  correr('sentinel.config.json', ESQUEMA_SENTINEL());
  correr('varsense.config.json', ESQUEMA_VARSENSE());
  return problemas;
}
