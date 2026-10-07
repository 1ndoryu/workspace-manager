/* Rutas Guard del tope físico anti-espiral (07AA-6 F6): lectura del estado
 * (política/modo/budgets + diario runs.jsonl + override) y control (cambio de
 * modo + ampliación auditable) por proyecto.
 * [por que] Dominio propio separado de rutasGate.ts (que es configs + análisis
 * + vulnerabilidades): el Guard es el tope de validaciones pesadas, con sus
 * rutas `/api/guard/*`. La clave se resuelve desde el snapshot (anti-traversal);
 * solo proyectos con puerta sentinel son elegibles. Red local sin secretos en
 * respuestas (el diario no trae ninguno). Devuelve true si atendió la ruta. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { campoStr, json, leerBody } from '../http.js';
import { snapshotArea } from '../snapshot.js';
import { esElegible } from '../gate/analizador.js';
import { leerGuardProyecto, type ModoTope } from './lector.js';

function proyectoPorClave(clave: string) {
  const { snapshot } = snapshotArea(false);
  return snapshot.proyectos.find((p) => p.clave === clave) ?? null;
}

function esModo(v: unknown): v is ModoTope {
  return v === 'observe' || v === 'enforce';
}

export async function manejarRutasGuard(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  /* Estado Guard de un proyecto: política + override + diario por tarea.
   * [por que] Es la lectura que alimenta la sección Guard (quién/qué/cuándo/
   * por qué): solo lee ficheros del proyecto, nunca ejecuta el gate. */
  if (ruta === '/api/guard/estado') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const clave = url.searchParams.get('clave') ?? '';
    const proyecto = proyectoPorClave(clave);
    if (!proyecto) {
      json(res, 404, { error: 'Proyecto no encontrado', clave });
      return true;
    }
    if (!esElegible(proyecto)) {
      json(res, 200, { clave, elegible: false });
      return true;
    }
    json(res, 200, { elegible: true, ...leerGuardProyecto(clave, proyecto.ruta) });
    return true;
  }
  /* Estado Guard de todo el área (solo lectura de ficheros, sin re-escaneo
   * git: snapshotArea(false)). [por que] El barrido agregado del panel no
   * puede costar un escaneo raíz; los no elegibles van como elegible:false. */
  if (ruta === '/api/guard/estado-todo') {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const { snapshot } = snapshotArea(false);
    json(res, 200, {
      total: snapshot.proyectos.length,
      proyectos: snapshot.proyectos.map((p) =>
        esElegible(p)
          ? { elegible: true as const, ...leerGuardProyecto(p.clave, p.ruta) }
          : { clave: p.clave, elegible: false as const },
      ),
    });
    return true;
  }
  /* Cambio de modo del tope (observe|enforce) en sentinel.config.json.
   * [por que] Control mínimo del panel: edita SOLO la clave budgets.mode
   * preservando el resto del JSON (parse estricto: si el config no parsea,
   * 422 y a editar a mano, nunca se escribe a ciegas). Reescribe el fichero
   * con indent 2 (el formato canónico de los configs del área). */
  if (ruta === '/api/guard/modo') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as { clave?: unknown; mode?: unknown };
    const clave = campoStr(body, 'clave', '');
    const proyecto = proyectoPorClave(clave);
    if (!proyecto) {
      json(res, 404, { error: 'Proyecto no encontrado', clave });
      return true;
    }
    if (!esElegible(proyecto)) {
      json(res, 400, { error: 'El proyecto no usa sentinel', clave });
      return true;
    }
    if (!esModo(body.mode)) {
      json(res, 400, { error: 'mode invalido (observe|enforce)' });
      return true;
    }
    const rutaArchivo = join(proyecto.ruta, 'sentinel.config.json');
    let valor: Record<string, unknown>;
    try {
      valor = JSON.parse(readFileSync(rutaArchivo, 'utf8')) as Record<string, unknown>;
    } catch {
      json(res, 422, { error: 'sentinel.config.json no es JSON valido: editalo a mano' });
      return true;
    }
    const budgets =
      valor.budgets && typeof valor.budgets === 'object' && !Array.isArray(valor.budgets)
        ? (valor.budgets as Record<string, unknown>)
        : {};
    budgets.mode = body.mode;
    valor.budgets = budgets;
    try {
      writeFileSync(rutaArchivo, `${JSON.stringify(valor, null, 2)}\n`, 'utf8');
    } catch (err) {
      json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
      return true;
    }
    json(res, 200, { ok: true, clave, mode: body.mode });
    return true;
  }
  /* Ampliación auditable del cupo: escribe <raíz>/lote-extra.md con +N.
   * [por que] Es el override que Sentinel ya honra (D1): el primer entero del
   * fichero suma N al límite. Se exige motivo no vacío para que la ampliación
   * quede justificada en el propio fichero (auditable, no silenciosa). */
  if (ruta === '/api/guard/lote-extra') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as { clave?: unknown; puntos?: unknown; motivo?: unknown };
    const clave = campoStr(body, 'clave', '');
    const motivo = campoStr(body, 'motivo', '').trim();
    const proyecto = proyectoPorClave(clave);
    if (!proyecto) {
      json(res, 404, { error: 'Proyecto no encontrado', clave });
      return true;
    }
    if (!esElegible(proyecto)) {
      json(res, 400, { error: 'El proyecto no usa sentinel', clave });
      return true;
    }
    const puntos = typeof body.puntos === 'number' ? body.puntos : NaN;
    if (!Number.isInteger(puntos) || puntos < 1 || puntos > 100) {
      json(res, 400, { error: 'puntos invalido (entero 1..100)' });
      return true;
    }
    if (motivo === '') {
      json(res, 400, { error: 'motivo requerido (ampliacion auditable)' });
      return true;
    }
    const hoy = new Date().toISOString().slice(0, 10);
    try {
      writeFileSync(join(proyecto.ruta, 'lote-extra.md'), `+${puntos} ${motivo} (${hoy})\n`, 'utf8');
    } catch (err) {
      json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
      return true;
    }
    json(res, 200, { ok: true, clave, extra: puntos });
    return true;
  }
  return false;
}
