/* Rutas del gate por proyecto (/api/proyecto/gate, /api/proyectos/doctor,
 * /api/gate/*): leer/editar configs del gate, doctor, reglas, esquema
 * dinámico, sincronización, análisis sentinel/varsense y vulnerabilidades.
 * [por que] Extraído de `index.ts` (límite-líneas): es el dominio "gate",
 * con sus importaciones propias (proveedor, sincronización, analizador,
 * vulnerabilidades). Devuelve true si atendió la ruta, false si no es suya.
 * Cada ruta es un manejador en la tabla RUTAS_GATE: añadir una no obliga a
 * tocar una cadena de ifs. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { campoStr, json, leerArchivo, leerBody } from '../http.js';
import { snapshotArea } from '../snapshot.js';
import { ARCHIVOS_GATE } from '../scanner/gate.js';
import { doctorCacheado } from '../gate/herramientas/doctor.js';
import { esquemaGate, reglasGate } from '../gate/herramientas/proveedor.js';
import { esquemaPorArchivo } from '../../shared/gate/catalogo/esquemas.js';
import { diagnosticar, rutaEtiqueta, severidadDe } from '../../shared/gate/modelo/esquema.js';
import { correrSincronizacion } from '../gate/sincronizacion.js';
import { analizarParaGate, analizarProyecto, analizarTodo, analisisVigentes, analisisVigentePara, esElegible } from '../gate/analizador.js';
import { compararHallazgos } from '../gate/hallazgos/comparacion.js';
import { auditarProyecto, auditarTodo, auditoriaVigentePara, auditoriasVigentes } from '../gate/vulnerabilidades/vulnerabilidades.js';
import { logger } from '../../shared/logger.js';
import type { AnalisisSentinel, AnalisisVulnerabilidades, HallazgoSentinel } from '../../shared/types.js';

interface Contexto {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
}

type Manejador = (c: Contexto) => Promise<void>;

/* Responde 405 y devuelve false si el método no es el esperado. */
function soloMetodo(c: Contexto, metodo: string): boolean {
  if (c.req.method === metodo) return true;
  json(c.res, 405, { error: 'Metodo no permitido' });
  return false;
}

/* Proyecto para el gate sin re-escanear el área entera: la huella del árbol lee HEAD
 * y los cambios por su cuenta, así que basta el snapshot en memoria. Solo se
 * re-escanea si el proyecto no está. [por que] Coste medido del escaneo completo en
 * la 89 (19 proyectos): 151 ms en frío, 54 ms en el segundo (ver docs/rendimiento.md). */
async function proyectoParaGate(clave: string) {
  const buscar = async (forzar: boolean) =>
    (await snapshotArea(forzar)).snapshot.proyectos.find((p) => p.clave === clave);
  /* [por que] `await` en cada lado: con `??` directo, una promesa nunca es nula y no se re-escanearía. */
  return (await buscar(false)) ?? buscar(true);
}

/* Re-escaneo genuino (git, HEAD, rama) para los botones «escanea ahora».
 * [por que] Si se usara snapshotArea(false), el snapshotMemoria nunca se invalida
 * mientras viva el server: aunque el usuario commitee, el HEAD seguiría viejo, la
 * frescura no cambiaría y la caché de análisis se serviría sin re-ejecutar sentinel. */
async function escaneoFresco() {
  return (await snapshotArea(true)).snapshot;
}

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

async function guardarArchivoGate(c: Contexto, proyecto: { ruta: string }, clave: string): Promise<void> {
  const body = (await leerBody(c.req)) as { nombre?: unknown; contenido?: unknown };
  const nombre = campoStr(body, 'nombre', '');
  const contenido = campoStr(body, 'contenido', null);
  if ((ARCHIVOS_GATE as readonly string[]).includes(nombre) === false || contenido === null) {
    json(c.res, 400, { error: 'archivo o contenido invalido' });
    return;
  }
  /* [por que] Validar JSON antes de escribir: no se permite romper el gate de un proyecto
   * con JSON inválido. Solo se exige parseable (no se re-serializa, para no reformatear).
   * Si el archivo tiene esquema curado, los avisos de esquema se devuelven NO bloqueantes:
   * guardar con un error de esquema es legítimo a mitad de edición. */
  let valor: unknown = null;
  try {
    valor = JSON.parse(contenido) as unknown;
  } catch {
    json(c.res, 422, { error: 'JSON invalido', detalle: 'el contenido no es JSON valido' });
    return;
  }
  const avisos = avisosDeEsquema(nombre, valor);
  const rutaArchivo = join(proyecto.ruta, nombre);
  try {
    writeFileSync(rutaArchivo, contenido, 'utf8');
    try {
      await snapshotArea(true);
    } catch (err) {
      logger.warn('re-escaneo tras guardar [gate] fallo:', err);
    }
    json(c.res, 200, {
      ok: true,
      clave,
      nombre,
      ruta: rutaArchivo,
      avisos: avisos.slice(0, 10),
      totalErrores: avisos.filter((a) => a.severidad === 'error').length,
      totalAdvertencias: avisos.filter((a) => a.severidad === 'advertencia').length,
    });
  } catch (err) {
    json(c.res, 500, { error: 'No se pudo escribir', detalle: String(err) });
  }
}

/* Avisos del diagnóstico contra el esquema curado del archivo (vacío si no tiene). */
function avisosDeEsquema(nombre: string, valor: unknown) {
  const esquema = esquemaPorArchivo(nombre) ?? null;
  if (!esquema) return [];
  return diagnosticar(esquema, valor)
    .map((f) => ({ ruta: rutaEtiqueta(f.ruta), severidad: severidadDe(f) }))
    .filter((a) => a.severidad !== null);
}

async function doctorDeProyecto(c: Contexto): Promise<void> {
  const id = c.url.searchParams.get('id') ?? '';
  const { snapshot } = await snapshotArea(false);
  const proyecto = snapshot.proyectos.find(p => p.id === id || p.ruta.endsWith(id));
  if (!proyecto) {
    json(c.res, 404, { error: 'Proyecto no encontrado', id });
    return;
  }
  /* `modo` es dónde corrió de verdad y `aviso` por qué se cayó al portátil: sin ellos
   * un `doctor: null` no distingue «no se pudo» de «no se pidió» (frente 5). */
  const fresco = c.url.searchParams.get('fresco') === '1';
  const { salida, modo, aviso, edadMs } = await doctorCacheado(proyecto.clave, proyecto.ruta, { fresco });
  json(c.res, 200, { id, doctor: salida, modo, aviso, edadMs });
}

/* Catálogo de reglas VIVO del gate desde el runtime sentinel.
 * [por que] El cliente es 'tonto': no importa el snapshot de reglas en el bundle; el
 * server resuelve el runtime instalado y sirve las reglas reales (con fallback al
 * catálogo estático embebido). */
async function reglas(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'GET')) return;
  const { version, fuente, reglas: lista } = reglasGate();
  json(c.res, 200, { version, fuente, total: lista.length, reglas: lista });
}

/* Esquema del gate DINÁMICO (E1 gate-dinamico): sirve el esquema de config de una
 * herramienta (sentinel/varsense) + sus reglas + metadata de versión. El esquema va
 * SERIALIZADO (ciclos resueltos a refs); el cliente lo rehidrata. Nunca toca el JSON
 * real de ningún proyecto. */
async function esquemaDinamico(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'GET')) return;
  const tool = (c.url.searchParams.get('tool') ?? '') as 'sentinel' | 'varsense';
  if (tool !== 'sentinel' && tool !== 'varsense') {
    json(c.res, 400, { error: 'tool invalido (sentinel|varsense)' });
    return;
  }
  const r = esquemaGate(tool);
  if (!r) {
    json(c.res, 404, { error: `proveedor ${tool} no registrado` });
    return;
  }
  json(c.res, 200, {
    tool,
    metadatos: r.metadatos,
    esquema: JSON.parse(r.esquemaText) as unknown,
    reglas: r.reglas,
    totalReglas: r.totalReglas,
  });
}

/* Estado de centralización del gate (plan centralizar-gate 308A-1 F7): corre
 * quality-sync.mjs --json y sirve el reporte. [por que] Es GET puro de lectura, pero NO
 * es barato (~8,4 s medidos): el informe se cachea en correrSincronizacion y aquí solo
 * se decide si se salta la caché. */
async function sincronizacion(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'GET')) return;
  /* `forzar=1` lo manda el botón 'verificar alineación' (dato fresco sí o sí);
   * abrir la pestaña reúsa el informe cacheado si aún es joven. */
  const reporte = await correrSincronizacion(c.url.searchParams.get('forzar') === '1');
  json(c.res, 200, { reporte });
}

/* Análisis real de sentinel por proyecto (plan analisis-sentinel-consola A0/A1).
 * [por que] El cliente es 'tonto' y este módulo es el dueño de la ejecución: nunca corre
 * dentro del escaneo raíz (que es asíncrono y aparte). La caché por frescura
 * (branch+HEAD+version) evita revert spawns sin cambios. */
async function analizarUno(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'POST')) return;
  const body = (await leerBody(c.req)) as { clave?: unknown; forzar?: unknown; arbol?: unknown; local?: unknown };
  const clave = campoStr(body, 'clave', '');
  const forzar = body.forzar === true;
  /* arbol=true: análisis del gate (cuenta el árbol de trabajo, caché por huella). */
  const arbol = body.arbol === true;
  /* local=true: emergencia (`--local`), se analiza aquí y no se cachea. */
  const emergencia = body.local === true;
  const proyecto = arbol ? await proyectoParaGate(clave) : (await escaneoFresco()).proyectos.find((p) => p.clave === clave);
  if (!proyecto) {
    json(c.res, 404, { error: 'Proyecto no encontrado', clave });
    return;
  }
  if (!esElegible(proyecto)) {
    json(c.res, 400, { error: 'El proyecto no usa sentinel (no se puede analizar)', clave });
    return;
  }
  json(c.res, 200, await (arbol ? analizarParaGate(proyecto, forzar, emergencia) : analizarProyecto(proyecto, forzar, emergencia)));
}

/* Barrido completo del workspace (serial de los elegibles). El body puede pedir
 * forzar=true (botón manual 'escanea ahora' = genuino: vuelve a ejecutar sentinel aunque
 * la frescura no cambió); el auto-timer manda forzar=false y reúsa la caché.
 * [por que] Se incluye el snapshot fresco (git/HEAD real) en la respuesta: el cliente
 * DEBE aplicarlo, si no la consola sigue mostrando los contadores de git del arranque. */
async function analizarTodoWorkspace(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'POST')) return;
  const body = (await leerBody(c.req)) as { forzar?: unknown; local?: unknown };
  const forzar = body.forzar === true;
  const snapshot = await escaneoFresco();
  const analisis = await analizarTodo(snapshot.proyectos, forzar, body.local === true);
  json(c.res, 200, {
    escaneadoEn: new Date().toISOString(),
    snapshot,
    proyectos: analisis,
  });
}

/* Hallazgos NUEVOS frente a una línea base (10AA-2 F9.4). Body { clave, base }: base es
 * el snapshot que guardó `gate --inicio`. Analiza con huella del árbol (analizarParaGate):
 * cuenta el árbol de trabajo, no solo HEAD, y un árbol sin cambios reutiliza el análisis.
 * [por que] Un análisis en error no se devuelve como «sin nuevos»: sería un falso verde. */
async function comparar(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'POST')) return;
  const body = (await leerBody(c.req)) as { clave?: unknown; base?: unknown; forzar?: unknown; local?: unknown };
  const clave = campoStr(body, 'clave', '');
  const base = body.base;
  const formaValida =
    Array.isArray(base) &&
    base.every((h) => typeof h === 'object' && h !== null && typeof (h as HallazgoSentinel).ruleId === 'string');
  if (!formaValida) {
    json(c.res, 400, { error: 'base debe ser una lista de hallazgos', clave });
    return;
  }
  const proyecto = await proyectoParaGate(clave);
  if (!proyecto) {
    json(c.res, 404, { error: 'Proyecto no encontrado', clave });
    return;
  }
  if (!esElegible(proyecto)) {
    json(c.res, 400, { error: 'El proyecto no usa sentinel (no se puede comparar)', clave });
    return;
  }
  const analisis = await analizarParaGate(proyecto, body.forzar === true, body.local === true);
  if (analisis.estado === 'error') {
    json(c.res, 502, { error: 'El análisis falló; no se puede comparar', clave, detalle: analisis.error });
    return;
  }
  const { nuevos, resueltos } = compararHallazgos(base as HallazgoSentinel[], analisis.hallazgos);
  json(c.res, 200, {
    clave,
    analizadoEn: analisis.analizadoEn,
    total: analisis.hallazgos.length,
    resueltos,
    nuevos,
  });
}

/* Caché de análisis. GET sin ?clave devuelve TODA la caché persistida para que el cliente
 * rehidrate el store al recargar (sin volver a analizar); con ?clave solo el de un proyecto.
 * [por que] Solo lo vigente (ver vigencia.ts): un dato de otro HEAD no se sirve. */
async function cacheAnalisis(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'GET')) return;
  const clave = c.url.searchParams.get('clave') ?? '';
  if (clave === '') {
    const { snapshot } = await snapshotArea(false);
    const analisis = analisisVigentes(snapshot.proyectos);
    const porClave: Record<string, AnalisisSentinel> = {};
    for (const a of analisis) porClave[a.clave] = a;
    json(c.res, 200, { total: analisis.length, analisis: porClave });
    return;
  }
  const proyecto = await proyectoParaGate(clave);
  json(c.res, 200, { clave, analisis: proyecto ? analisisVigentePara(proyecto) : null });
}

/* Vulnerabilidades de dependencias por proyecto (plan vulnerabilidades-consola 308A-4 V1).
 * Homólogo a /api/gate/analisis pero para audit: POST audita (con caché por hash-de-lockfile
 * y single-flight). El snapshot se re-escanea por git real antes de auditar. */
async function vulnerabilidadesUno(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'POST')) return;
  const { snapshot } = await snapshotArea(true);
  const body = (await leerBody(c.req)) as { clave?: unknown; forzar?: unknown };
  const clave = campoStr(body, 'clave', '');
  const forzar = body.forzar === true;
  const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
  if (!proyecto) {
    json(c.res, 404, { error: 'Proyecto no encontrado', clave });
    return;
  }
  json(c.res, 200, await auditarProyecto(proyecto, forzar));
}

async function vulnerabilidadesTodo(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'POST')) return;
  const { snapshot } = await snapshotArea(true);
  const body = (await leerBody(c.req)) as { forzar?: unknown };
  const forzar = body.forzar === true;
  const vuls = await auditarTodo(snapshot.proyectos, forzar);
  json(c.res, 200, {
    escaneadoEn: new Date().toISOString(),
    snapshot,
    proyectos: vuls,
  });
}

/* Caché de vulnerabilidades. GET sin ?clave devuelve TODA la caché persistida para
 * rehidratar el store al recargar (sin re-auditar). */
async function cacheVulnerabilidades(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'GET')) return;
  const clave = c.url.searchParams.get('clave') ?? '';
  /* [por que] Solo lo vigente (ver vigencia.ts): una auditoría de otro lockfile no se sirve. */
  if (clave === '') {
    const { snapshot } = await snapshotArea(false);
    const vuls = auditoriasVigentes(snapshot.proyectos);
    const porClave: Record<string, AnalisisVulnerabilidades> = {};
    for (const v of vuls) porClave[v.clave] = v;
    json(c.res, 200, { total: vuls.length, vulnerabilidades: porClave });
    return;
  }
  const proyecto = await proyectoParaGate(clave);
  json(c.res, 200, { clave, vulnerabilidad: proyecto ? auditoriaVigentePara(proyecto) : null });
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
