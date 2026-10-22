/* Rutas del gate por proyecto (/api/proyecto/gate, /api/proyectos/doctor,
 * /api/gate/*): leer/editar configs del gate, doctor, reglas, esquema
 * dinámico, sincronización, análisis sentinel/varsense y vulnerabilidades.
 * [por que] Extraído de `index.ts` (límite-líneas): es el dominio "gate",
 * con sus importaciones propias (proveedor, sincronización, analizador,
 * vulnerabilidades). Devuelve true si atendió la ruta, false si no es suya.
 * Cada ruta es un manejador en la tabla RUTAS_GATE: añadir una no obliga a
 * tocar una cadena de ifs. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { json, leerArchivo } from '../http.js';
import { snapshotArea } from '../snapshot.js';
import { ARCHIVOS_GATE } from '../scanner/gate.js';
import { guardarArchivoGate } from './rutasGate/rutasGate-escritura.js';
import {
  analizarUno,
  analizarTodoWorkspace,
  cacheAnalisis,
  cacheVulnerabilidades,
  comparar,
  doctorDeProyecto,
  esquemaDinamico,
  reglas,
  sincronizacion,
  vulnerabilidadesTodo,
  vulnerabilidadesUno,
  type Contexto,
  type Manejador,
} from './rutasGate/rutasGate-handlers.js';

/* Gate por proyecto: leer/editar los archivos de config (sentinel / varsense).
 * [por que] El panel de configuración por proyecto muestra el estado del gate y
 * permite controlar sus reglas editando el JSON real; la ruta se resuelve desde el
 * snapshot por clave y el nombre está en whitelist (anti-traversal). */
async function gateDelProyecto(c: Contexto): Promise<void> {
  const clave = c.url.searchParams.get('clave') ?? '';
  const { snapshot } = await snapshotArea(false);
  const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
  if (!proyecto) {
    json(c.res, 404, { error: 'Proyecto no encontrado', clave });
    return;
  }
  if (c.req.method === 'GET') return verGateProyecto(c, proyecto, clave);
  if (c.req.method === 'POST') return guardarArchivoGate(c, proyecto, clave);
  json(c.res, 405, { error: 'Metodo no permitido' });
}

function verGateProyecto(c: Contexto, proyecto: { ruta: string; gate?: unknown }, clave: string): void {
  const archivos = ARCHIVOS_GATE.map((n) => ({
    nombre: n,
    existe: existsSync(join(proyecto.ruta, n)),
  })).filter((a) => a.existe);
  /* [por que] JSON válido con comentarios: el JSON del gate puede traer // y bloques
   * de comentario (JSONC). Para editarlo se envía el archivo crudo; la validación
   * estricta solo se exige al escribir. */
  const contenidos = Object.fromEntries(
    archivos.map((a) => [a.nombre, leerArchivo(join(proyecto.ruta, a.nombre))]),
  );
  json(c.res, 200, { clave, estado: proyecto.gate, archivos, contenidos });
}

/* Tabla de rutas. Las del análisis y las de vulnerabilidades comparten método con su
 * variante «todo», por eso cada una tiene su manejador propio. */
const RUTAS_GATE: Record<string, Manejador> = {
  '/api/proyecto/gate': gateDelProyecto,
  '/api/proyectos/doctor': doctorDeProyecto,
  '/api/gate/reglas': reglas,
  '/api/gate/dinamico': esquemaDinamico,
  '/api/gate/sincronizacion': sincronizacion,
  '/api/gate/analizar': analizarUno,
  '/api/gate/analizar-todo': analizarTodoWorkspace,
  '/api/gate/comparar': comparar,
  '/api/gate/analisis': cacheAnalisis,
  '/api/gate/vulnerabilidades': vulnerabilidadesUno,
  '/api/gate/vulnerabilidades-todo': vulnerabilidadesTodo,
  '/api/gate/vulnerabilidades-cache': cacheVulnerabilidades,
};

export async function manejarRutasGate(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  const manejador = Object.prototype.hasOwnProperty.call(RUTAS_GATE, ruta) ? RUTAS_GATE[ruta] : undefined;
  if (!manejador) return false;
  await manejador({ req, res, url });
  return true;
}
