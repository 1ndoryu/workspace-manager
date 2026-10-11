/* Rutas Guard de solo lectura (07AA-6 F6, retiradas las escrituras en 10AA-2 F11.1):
 * estado del tope anti-espiral por proyecto (política/modo/budgets + diario
 * runs.jsonl + override). Lo consume la base de «Topes» de la pestaña Guardián.
 * [por que] Las escrituras (/api/guard/modo y /api/guard/lote-extra) se quitan:
 * escribían sin atomicidad ni comprobación de origen, y lote-extra.md se
 * sobrescribía. Las ediciones volverán por el escritor seguro de F11.4.
 * La clave se resuelve desde el snapshot (anti-traversal); solo proyectos con
 * puerta sentinel son elegibles. Red local sin secretos en respuestas. Devuelve
 * true si atendió la ruta. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import { snapshotArea } from '../snapshot.js';
import { esElegible } from '../gate/analizador.js';
import { leerGuardProyecto } from '../guardian/lector.js';

function proyectoPorClave(clave: string) {
  const { snapshot } = snapshotArea(false);
  return snapshot.proyectos.find((p) => p.clave === clave) ?? null;
}

export async function manejarRutasGuard(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  /* Estado Guard de un proyecto: política + override + diario por tarea.
   * [por que] Solo lee ficheros del proyecto, nunca ejecuta el gate. */
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
   * git: snapshotArea(false)). [por que] El barrido agregado no puede costar un
   * escaneo raíz; los no elegibles van como elegible:false. */
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
  return false;
}
