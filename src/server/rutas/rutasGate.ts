/* Rutas del gate por proyecto (/api/proyecto/gate, /api/proyectos/doctor,
 * /api/gate/*): leer/editar configs del gate, doctor, reglas, esquema
 * dinámico, sincronización, análisis sentinel/varsense y vulnerabilidades.
 * [por que] Extraído de `index.ts` (límite-líneas): es el dominio "gate",
 * con sus importaciones propias (proveedor, sincronización, analizador,
 * vulnerabilidades). Devuelve true si atendió la ruta, false si no es suya. */
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

/* Proyecto para el gate sin re-escanear el área entera (~14 s con git de todos
 * los proyectos): la huella del árbol lee HEAD y los cambios por su cuenta, así
 * que basta el snapshot en memoria. Solo se re-escanea si el proyecto no está. */
async function proyectoParaGate(clave: string) {
  const buscar = async (forzar: boolean) =>
    (await snapshotArea(forzar)).snapshot.proyectos.find((p) => p.clave === clave);
  /* [por que] `await` en cada lado: con `??` directo, una promesa nunca es nula y no se re-escanearía. */
  return (await buscar(false)) ?? buscar(true);
}

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
    const { snapshot } = await snapshotArea(false);
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
      const nombre = campoStr(body, 'nombre', '');
      const contenido = campoStr(body, 'contenido', null);
      if ((ARCHIVOS_GATE as readonly string[]).includes(nombre) === false || contenido === null) {
        json(res, 400, { error: 'archivo o contenido invalido' });
        return true;
      }
      /* [por que] Validar JSON antes de escribir: no se permite romper
       * el gate de un proyecto con JSON inválido. Solo se exige
       * parseable (no se re-serializa, para no reformatear). Si el archivo
       * tiene esquema curado (sentinel/varsense.config.json), se devuelve
       * ADEMÁS el diagnóstico contra el esquema como avisos NO bloqueantes:
       * guardar con un error de esquema es legítimo a mitad de edición y
       * la consola ya lo reporta; aquí solo se avisa en la respuesta. */
      let valor: unknown = null;
      try {
        valor = JSON.parse(contenido) as unknown;
      } catch {
        json(res, 422, { error: 'JSON invalido', detalle: 'el contenido no es JSON valido' });
        return true;
      }
      const esquema = esquemaPorArchivo(nombre) ?? null;
      const avisos = esquema
        ? diagnosticar(esquema, valor)
          .map((f) => ({ ruta: rutaEtiqueta(f.ruta), severidad: severidadDe(f) }))
          .filter((a) => a.severidad !== null)
        : [];
      const rutaArchivo = join(proyecto.ruta, nombre);
      try {
        writeFileSync(rutaArchivo, contenido, 'utf8');
        try {
          await snapshotArea(true);
        } catch (err) {
          logger.warn('re-escaneo tras guardar [gate] fallo:', err);
        }
        json(res, 200, {
          ok: true,
          clave,
          nombre,
          ruta: rutaArchivo,
          avisos: avisos.slice(0, 10),
          totalErrores: avisos.filter((a) => a.severidad === 'error').length,
          totalAdvertencias: avisos.filter((a) => a.severidad === 'advertencia').length,
        });
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
    const { snapshot } = await snapshotArea(false);
    const proyecto = snapshot.proyectos.find(p => p.id === id || p.ruta.endsWith(id));
    if (!proyecto) {
      json(res, 404, { error: 'Proyecto no encontrado', id });
      return true;
    }
    /* `modo` es dónde corrió de verdad y `aviso` por qué se cayó al portátil: sin ellos
     * un `doctor: null` no distingue «no se pudo» de «no se pidió» (frente 5). */
    const fresco = url.searchParams.get('fresco') === '1';
    const { salida, modo, aviso, edadMs } = await doctorCacheado(proyecto.clave, proyecto.ruta, { fresco });
    json(res, 200, { id, doctor: salida, modo, aviso, edadMs });
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
   * importar ESQUEMA_* estáticos en el bundle y lo pide aquí. El esquema
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
      reglas: r.reglas,
      totalReglas: r.totalReglas,
    });
    return true;
  }
  /* Estado de centralización del gate (plan centralizar-gate 308A-1 F7):
   * corre quality-sync.mjs --json (reúsa la validación fail-closed que ya
   * existe) y sirve el reporte. [por que] Es GET puro de lectura: no toca
   * el escaneo raíz ni ningún JSON real, y la UI lo muestra con badges
   * verde/desync. NO es barato —recorre cada consumidor y cada checkout
   * distinto con varios git más un ls-remote a su remoto: ~8,4 s medidos—,
   * así que el informe se cachea en correrSincronizacion y aquí solo se
   * decide si se salta la caché. */
  if (ruta === '/api/gate/sincronizacion') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    /* `forzar=1` lo manda el botón 'verificar alineación' (dato fresco sí o sí);
     * abrir la pestaña reúsa el informe cacheado si aún es joven. */
    const reporte = await correrSincronizacion(url.searchParams.get('forzar') === '1');
    json(res, 200, { reporte });
    return true;
  }
  /* Análisis real de sentinel por proyecto (plan analisis-sentinel-consola
   * A0/A1). [por que] El cliente es 'tonto' y este módulo es el dueño de
   * la ejecución: nunca corre dentro del escaneo raíz (que es asíncrono y
   * aparte). La caché
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
    const escanear = async () => (await snapshotArea(true)).snapshot;
    /* Un proyecto: body { clave, forzar?, arbol? }. Solo si es elegible (sentinel). */
    if (ruta === '/api/gate/analizar') {
      const body = (await leerBody(req)) as { clave?: unknown; forzar?: unknown; arbol?: unknown };
      const clave = campoStr(body, 'clave', '');
      const forzar = body.forzar === true;
      /* arbol=true: análisis del gate (cuenta el árbol de trabajo, caché por huella). */
      const arbol = body.arbol === true;
      const proyecto = arbol ? await proyectoParaGate(clave) : (await escanear()).proyectos.find((p) => p.clave === clave);
      if (!proyecto) {
        json(res, 404, { error: 'Proyecto no encontrado', clave });
        return true;
      }
      if (!esElegible(proyecto)) {
        json(res, 400, { error: 'El proyecto no usa sentinel (no se puede analizar)', clave });
        return true;
      }
      json(res, 200, await (arbol ? analizarParaGate(proyecto, forzar) : analizarProyecto(proyecto, forzar)));
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
    const snapshot = await escanear();
    const analisis = await analizarTodo(snapshot.proyectos, forzar);
    json(res, 200, {
      escaneadoEn: new Date().toISOString(),
      snapshot,
      proyectos: analisis,
    });
    return true;
  }
  /* Hallazgos NUEVOS frente a una línea base (10AA-2 F9.4). Body { clave, base }:
   * base es el snapshot que guardó `gate --inicio`. Analiza con huella del
   * árbol (analizarParaGate): cuenta el árbol de trabajo, no solo HEAD, y un
   * árbol sin cambios reutiliza el análisis; body.forzar lo salta.
   * [por que] Un análisis en error no se devuelve como «sin nuevos»: sería un falso verde. */
  if (ruta === '/api/gate/comparar') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as { clave?: unknown; base?: unknown; forzar?: unknown };
    const clave = campoStr(body, 'clave', '');
    const base = body.base;
    const formaValida =
      Array.isArray(base) &&
      base.every((h) => typeof h === 'object' && h !== null && typeof (h as HallazgoSentinel).ruleId === 'string');
    if (!formaValida) {
      json(res, 400, { error: 'base debe ser una lista de hallazgos', clave });
      return true;
    }
    const proyecto = await proyectoParaGate(clave);
    if (!proyecto) {
      json(res, 404, { error: 'Proyecto no encontrado', clave });
      return true;
    }
    if (!esElegible(proyecto)) {
      json(res, 400, { error: 'El proyecto no usa sentinel (no se puede comparar)', clave });
      return true;
    }
    const analisis = await analizarParaGate(proyecto, body.forzar === true);
    if (analisis.estado === 'error') {
      json(res, 502, { error: 'El análisis falló; no se puede comparar', clave, detalle: analisis.error });
      return true;
    }
    const { nuevos, resueltos } = compararHallazgos(base as HallazgoSentinel[], analisis.hallazgos);
    json(res, 200, {
      clave,
      analizadoEn: analisis.analizadoEn,
      total: analisis.hallazgos.length,
      resueltos,
      nuevos,
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
    /* [por que] Solo lo vigente (ver vigencia.ts): un dato de otro HEAD no se sirve. */
    if (clave === '') {
      const { snapshot } = await snapshotArea(false);
      const analisis = analisisVigentes(snapshot.proyectos);
      const porClave: Record<string, AnalisisSentinel> = {};
      for (const a of analisis) porClave[a.clave] = a;
      json(res, 200, { total: analisis.length, analisis: porClave });
      return true;
    }
    const proyecto = await proyectoParaGate(clave);
    json(res, 200, { clave, analisis: proyecto ? analisisVigentePara(proyecto) : null });
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
    const { snapshot } = await snapshotArea(true);
    if (ruta === '/api/gate/vulnerabilidades') {
      const body = (await leerBody(req)) as { clave?: unknown; forzar?: unknown };
      const clave = campoStr(body, 'clave', '');
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
    /* [por que] Solo lo vigente (ver vigencia.ts): una auditoría de otro lockfile no se sirve. */
    if (clave === '') {
      const { snapshot } = await snapshotArea(false);
      const vuls = auditoriasVigentes(snapshot.proyectos);
      const porClave: Record<string, AnalisisVulnerabilidades> = {};
      for (const v of vuls) porClave[v.clave] = v;
      json(res, 200, { total: vuls.length, vulnerabilidades: porClave });
      return true;
    }
    const proyecto = await proyectoParaGate(clave);
    json(res, 200, { clave, vulnerabilidad: proyecto ? auditoriaVigentePara(proyecto) : null });
    return true;
  }
  return false;
}
