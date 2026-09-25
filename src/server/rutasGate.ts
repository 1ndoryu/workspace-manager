/* Rutas del gate por proyecto (/api/proyecto/gate, /api/proyectos/doctor,
 * /api/gate/*): leer/editar configs del gate, doctor, reglas, esquema
 * dinámico, sincronización, análisis sentinel/varsense y vulnerabilidades.
 * [por que] Extraído de `index.ts` (límite-líneas): es el dominio "gate",
 * con sus importaciones propias (proveedor, sincronización, analizador,
 * vulnerabilidades). Devuelve true si atendió la ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { json, leerArchivo, leerBody } from './http.js';
import { snapshotArea } from './snapshot.js';
import { ARCHIVOS_GATE, doctorSentinel } from './scanner/gate.js';
import { esquemaGate, reglasGate } from './gate/proveedor.js';
import { correrSincronizacion } from './gate/sincronizacion.js';
import { analizarProyecto, analizarTodo, esElegible, leerAnalisis, leerTodas } from './gate/analizador.js';
import {
  auditarProyecto,
  auditarTodo,
  leerTodasVulnerabilidades,
  leerVulnerabilidades,
} from './gate/vulnerabilidades.js';
import { logger } from '../shared/logger.js';
import type { AnalisisSentinel, AnalisisVulnerabilidades } from '../shared/types.js';

export async function manejarRutasGate(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  /* Gate por proyecto: leer/editar los archivos de config (sentinel /
   * varsense). [por que] El panel de configuración por proyecto muestra
   * el estado del gate y permite controlar sus reglas editando el JSON
   * real; la ruta se resuelve desde el snapshot por clave y el nombre
   * está en whitelist (anti-traversal). */
  if (ruta === '/api/proyecto/gate') {
    const clave = url.searchParams.get('clave') ?? '';
    const { snapshot } = snapshotArea(false);
    const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
    if (!proyecto) {
      json(res, 404, { error: 'Proyecto no encontrado', clave });
      return true;
    }
    if (req.method === 'GET') {
      const archivos = ARCHIVOS_GATE.map((n) => ({
        nombre: n,
        existe: existsSync(join(proyecto.ruta, n)),
      })).filter((a) => a.existe);
      /* [por que] JSON válido con comentarios: el JSON del gate puede
       * traer // y bloques de comentario (JSONC). Para editarlo se envía
       * el archivo crudo; la validación estricta solo se exige al escribir. */
      const contenidos = Object.fromEntries(
        archivos.map((a) => [a.nombre, leerArchivo(join(proyecto.ruta, a.nombre))]),
      );
      json(res, 200, { clave, estado: proyecto.gate, archivos, contenidos });
      return true;
    }
    if (req.method === 'POST') {
      const body = (await leerBody(req)) as { nombre?: unknown; contenido?: unknown };
      const nombre = typeof body.nombre === 'string' ? body.nombre : '';
      const contenido = typeof body.contenido === 'string' ? body.contenido : null;
      if ((ARCHIVOS_GATE as readonly string[]).includes(nombre) === false || contenido === null) {
        json(res, 400, { error: 'archivo o contenido invalido' });
        return true;
      }
      /* [por que] Validar JSON antes de escribir: no se permite romper
       * el gate de un proyecto con JSON inválido. Solo se exige
       * parseable (no se re-serializa, para no reformatear). */
      try {
        JSON.parse(contenido);
      } catch {
        json(res, 422, { error: 'JSON invalido', detalle: 'el contenido no es JSON valido' });
        return true;
      }
      const rutaArchivo = join(proyecto.ruta, nombre);
      try {
        writeFileSync(rutaArchivo, contenido, 'utf8');
        try {
          snapshotArea(true);
        } catch (err) {
          logger.warn('re-escaneo tras guardar [gate] fallo:', err);
        }
        json(res, 200, { ok: true, clave, nombre, ruta: rutaArchivo });
      } catch (err) {
        json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
      }
      return true;
    }
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  if (ruta === '/api/proyectos/doctor') {
    const id = url.searchParams.get('id') ?? '';
    const { snapshot } = snapshotArea(false);
    const proyecto = snapshot.proyectos.find(p => p.id === id || p.ruta.endsWith(id));
    if (!proyecto) {
      json(res, 404, { error: 'Proyecto no encontrado', id });
      return true;
    }
    const doctor = doctorSentinel(proyecto.ruta);
    json(res, 200, { id, doctor });
    return true;
  }
  /* Catálogo de reglas VIVO del gate desde el runtime sentinel.
   * [por que] El cliente es 'tonto': no importa el snapshot de reglas
   * en el bundle, el server resuelve el runtime instalado y sirve las
   * reglas reales (con fallback al catálogo estático embebido). */
  if (ruta === '/api/gate/reglas') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const { version, fuente, reglas } = reglasGate();
    json(res, 200, { version, fuente, total: reglas.length, reglas });
    return true;
  }
  /* Esquema del gate DINÁMICO (E1 gate-dinamico): sirve el esquema de
   * config de una herramienta (sentinel/varsense) + sus reglas + metadata
   * de versión, resueltos por el server. El cliente es 'tonto': deja de
   * importar ESQUEMA_* estáticos en el bundle y pide todo acá. El esquema
   * va SERIALIZADO (ciclos resueltos a refs); el cliente lo rehidrata.
   * Nunca toca el JSON real de ningún proyecto. */
  if (ruta === '/api/gate/dinamico') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const tool = (url.searchParams.get('tool') ?? '') as 'sentinel' | 'varsense';
    if (tool !== 'sentinel' && tool !== 'varsense') {
      json(res, 400, { error: 'tool invalido (sentinel|varsense)' });
      return true;
    }
    const r = esquemaGate(tool);
    if (!r) {
      json(res, 404, { error: `proveedor ${tool} no registrado` });
      return true;
    }
    json(res, 200, {
      tool,
      metadatos: r.metadatos,
      esquema: JSON.parse(r.esquemaText) as unknown,
      reglas: r.metadatos.tipo === 'sentinel' ? reglasGate().reglas : [],
      totalReglas: r.totalReglas,
    });
    return true;
  }
  /* Estado de centralización del gate (plan centralizar-gate 308A-1 F7):
   * corre quality-sync.mjs --json (reúsa la validación fail-closed que ya
   * existe) y sirve el reporte. [por que] Es GET puro de lectura, de
   * corrida barata (git rev-parse del checkout y los manifests), sin tocar
   * el escaneo raíz ni ningún JSON real. La UI lo muestra con badges
   * verde/desync. */
  if (ruta === '/api/gate/sincronizacion') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const reporte = await correrSincronizacion();
    json(res, 200, { reporte });
    return true;
  }
  /* Análisis real de sentinel por proyecto (plan analisis-sentinel-consola
   * A0/A1). [por que] El cliente es 'tonto' y este módulo es el dueño de
   * la ejecución: nunca corre dentro del escaneo raíz (~2.6 s). La caché
   * por frescura (branch+HEAD+version) evita revert spawns sin cambios. */
  if (ruta === '/api/gate/analizar' || ruta === '/api/gate/analizar-todo') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    /* [por que] El botón 'escanea ahora' debe ser GENUINO: re-escanea el
     * snapshot (git, HEAD, rama) y re-ejecuta sentinel. Si se usara
     * snapshotArea(false), el snapshotMemoria del server nunca se
     * invalida mientras esté vivo: aunque el usuario commitee, el HEAD
     * sigue siendo el viejo, la frescura no cambia y la caché de
     * análisis se sirve sin re-ejecutar. forzar=true fuerza git real. */
    const { snapshot } = snapshotArea(true);
    /* Un proyecto: body { clave, forzar? }. Solo si es elegible (sentinel). */
    if (ruta === '/api/gate/analizar') {
      const body = (await leerBody(req)) as { clave?: unknown; forzar?: unknown };
      const clave = typeof body.clave === 'string' ? body.clave : '';
      const forzar = body.forzar === true;
      const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
      if (!proyecto) {
        json(res, 404, { error: 'Proyecto no encontrado', clave });
        return true;
      }
      if (!esElegible(proyecto)) {
        json(res, 400, { error: 'El proyecto no usa sentinel (no se puede analizar)', clave });
        return true;
      }
      json(res, 200, await analizarProyecto(proyecto, forzar));
      return true;
    }
    /* Barrido completo del workspace (serial de los elegibles). El body
     * puede pedir forzar=true (botón manual 'escanea ahora' = genuino:
     * vuelve a ejecutar sentinel aunque la frescura no cambió); el
     * auto-timer manda forzar=false y reúsa la caché por frescura.
     * [por que] Se incluye el snapshot fresco (git/HEAD real) en la
     * respuesta: el botón manual re-escanea git con snapshotArea(true) y
     * el cliente DEBE aplicarlo, si no la consola sigue mostrando
     * los contadores
     * de git (sin push/sin commit) del snapshot viejo del arranque. */
    const body = (await leerBody(req)) as { forzar?: unknown };
    const forzar = body.forzar === true;
    const analisis = await analizarTodo(snapshot.proyectos, forzar);
    json(res, 200, {
      escaneadoEn: new Date().toISOString(),
      snapshot,
      proyectos: analisis,
    });
    return true;
  }
  /* Caché de análisis. GET sin ?clave devuelve TODA la caché persistida
   * para que el cliente rehidrate el store al recargar (sin volver a
   * analizar); con ?clave solo el de un proyecto. [por que] Sin esto, al
   * recargar la página se perdía toda la info de análisis aunque el
   * servidor la tuviera cacheada en disco. */
  if (ruta === '/api/gate/analisis') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const clave = url.searchParams.get('clave') ?? '';
    if (clave === '') {
      const analisis = leerTodas();
      const porClave: Record<string, AnalisisSentinel> = {};
      for (const a of analisis) porClave[a.clave] = a;
      json(res, 200, { total: analisis.length, analisis: porClave });
      return true;
    }
    json(res, 200, { clave, analisis: leerAnalisis(clave) });
    return true;
  }
  /* Vulnerabilidades de dependencias por proyecto (plan
   * vulnerabilidades-consola 308A-4 V1). Homólogo a /api/gate/analisis
   * pero para audit: POST audita (con caché por hash-de-lockfile y
   * single-flight), GET sirve la caché para rehidratar al recargar. */
  if (
    ruta === '/api/gate/vulnerabilidades' ||
    ruta === '/api/gate/vulnerabilidades-todo'
  ) {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const { snapshot } = snapshotArea(true);
    if (ruta === '/api/gate/vulnerabilidades') {
      const body = (await leerBody(req)) as { clave?: unknown; forzar?: unknown };
      const clave = typeof body.clave === 'string' ? body.clave : '';
      const forzar = body.forzar === true;
      const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
      if (!proyecto) {
        json(res, 404, { error: 'Proyecto no encontrado', clave });
        return true;
      }
      json(res, 200, await auditarProyecto(proyecto, forzar));
      return true;
    }
    const body = (await leerBody(req)) as { forzar?: unknown };
    const forzar = body.forzar === true;
    const vuls = await auditarTodo(snapshot.proyectos, forzar);
    json(res, 200, {
      escaneadoEn: new Date().toISOString(),
      snapshot,
      proyectos: vuls,
    });
    return true;
  }
  /* Caché de vulnerabilidades. GET sin ?clave devuelve TODA la caché
   * persistida para rehidratar el store al recargar (sin re-auditar). */
  if (ruta === '/api/gate/vulnerabilidades-cache') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const clave = url.searchParams.get('clave') ?? '';
    if (clave === '') {
      const vuls = leerTodasVulnerabilidades();
      const porClave: Record<string, AnalisisVulnerabilidades> = {};
      for (const v of vuls) porClave[v.clave] = v;
      json(res, 200, { total: vuls.length, vulnerabilidades: porClave });
      return true;
    }
    json(res, 200, { clave, vulnerabilidad: leerVulnerabilidades(clave) });
    return true;
  }
  return false;
}
