/* Manejadores HTTP del gate por proyecto: cada ruta de RUTAS_GATE (rutasGate.ts) es una funcion
 * de aqui. [por que aparte] Son la capa que sabe de HTTP y de los servicios del gate; la
 * escritura de archivos y los avisos de esquema viven en sus modulos hermanos. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { campoStr, json, leerBody } from '../../http.js';
import { snapshotArea } from '../../snapshot.js';
import { doctorCacheado } from '../../gate/herramientas/doctor.js';
import { esquemaGate, reglasGate } from '../../gate/herramientas/proveedor.js';
import { tiposDeGate } from '../../../shared/gate/proveedores.js';
import { correrSincronizacion } from '../../gate/sincronizacion.js';
import { analizarParaGate, analizarProyecto, analizarTodo, analisisVigentes, analisisVigentePara, esElegible } from '../../gate/analizador.js';
import { compararHallazgos } from '../../gate/hallazgos/comparacion.js';
import { auditarProyecto, auditarTodo, auditoriaVigentePara, auditoriasVigentes } from '../../gate/vulnerabilidades/vulnerabilidades.js';
import type { AnalisisSentinel, AnalisisVulnerabilidades, HallazgoSentinel } from '../../../shared/types.js';

export interface Contexto {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
}

export type Manejador = (c: Contexto) => Promise<void>;

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

export async function doctorDeProyecto(c: Contexto): Promise<void> {
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
export async function reglas(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'GET')) return;
  const { version, fuente, reglas: lista } = reglasGate();
  json(c.res, 200, { version, fuente, total: lista.length, reglas: lista });
}

/* Esquema del gate DINÁMICO (E1 gate-dinamico): sirve el esquema de config de una
 * herramienta (sentinel/varsense) + sus reglas + metadata de versión. El esquema va
 * SERIALIZADO (ciclos resueltos a refs); el cliente lo rehidrata. Nunca toca el JSON
 * real de ningún proyecto. */
export async function esquemaDinamico(c: Contexto): Promise<void> {
  if (!soloMetodo(c, 'GET')) return;
  const pedido = c.url.searchParams.get('tool') ?? '';
  /* La validez la dicta el registro de proveedores, no una lista escrita aquí: una herramienta
   * nueva queda servida en cuanto se registra. */
  const tool = tiposDeGate().find((t) => t === pedido);
  if (!tool) {
    json(c.res, 400, { error: `tool invalido (${tiposDeGate().join('|')})` });
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
export async function sincronizacion(c: Contexto): Promise<void> {
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
export async function analizarUno(c: Contexto): Promise<void> {
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
export async function analizarTodoWorkspace(c: Contexto): Promise<void> {
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
export async function comparar(c: Contexto): Promise<void> {
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
export async function cacheAnalisis(c: Contexto): Promise<void> {
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
export async function vulnerabilidadesUno(c: Contexto): Promise<void> {
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

export async function vulnerabilidadesTodo(c: Contexto): Promise<void> {
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
export async function cacheVulnerabilidades(c: Contexto): Promise<void> {
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
