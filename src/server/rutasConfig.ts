/* Rutas de configuracion del area (/api/config, /api/config/singate,
 * /api/config/scan): ignorar/quitar proyectos, eximir sinGate y escaneo
 * automatico. [por que] Extraido de `index.ts` (limite-lineas): es el dominio
 * "config", con sus importaciones propias (configArea). Devuelve true si
 * atendio la ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, leerBody, RAIZ_AREA } from './http.js';
import { snapshotArea } from './snapshot.js';
import { cambiarIgnorado, cambiarSinGate, guardarConfigScan, leerConfigArea } from './configArea.js';
import { actualizarSnapshot } from './cache.js';
import { claveDe, resumenDe } from './scanner/workspace.js';
import type { ConfigScan, SnapshotWorkspace } from '../shared/types.js';

export async function manejarRutasConfig(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  /* Config del area: alternar un proyecto entre ignorar / dejar de
   * ignorar. La clave es la ruta relativa (no el nombre). */
  if (ruta === '/api/config') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as { op?: unknown; clave?: unknown };
    const op = body.op;
    const clave = typeof body.clave === 'string' ? body.clave : '';
    if ((op !== 'ignorar' && op !== 'quitar') || clave === '') {
      json(res, 400, { error: 'op o clave invalidos' });
      return true;
    }
    try {
      /* [por que] cambiarIgnorado persiste en disco y devuelve la config
       * nueva; se usa esa (no la del snapshot, que aun tiene la vieja). */
      const configNueva = cambiarIgnorado(RAIZ_AREA, clave, op === 'ignorar');
      /* Mutacion en memoria del snapshot cacheado: ignorar/quitar solo
       * cambia la visibilidad (no git/gate/roadmap), asi que NO se
       * re-escanea (escaneo completo ~2.6s). [por que] El usuario pidio
       * que el cambio se refleje en tiempo real; re-escandear aqui y
       * luego otra vez en el cliente duplicaba la latencia. */
      const base = snapshotArea(false);
      const ignoradoSet = new Set(configNueva.ignorados);
      const proyectos = base.snapshot.proyectos
        .map((p) => ({ ...p, clave: claveDe(p.ruta, RAIZ_AREA) }))
        .filter((p) => !ignoradoSet.has(p.clave));
      const mutado: SnapshotWorkspace = {
        ...base.snapshot,
        config: configNueva,
        proyectos,
        resumen: resumenDe(proyectos),
        escaneadoEn: new Date().toISOString(),
      };
      actualizarSnapshot(mutado);
      json(res, 200, { ok: true, config: configNueva, snapshot: mutado });
      return true;
    } catch (err) {
      json(res, 500, { error: 'No se pudo guardar la config', detalle: String(err) });
    }
    return true;
  }
  /* Exencion del gate (plan 308A-1 F6): marcar/desmarcar un proyecto
   * en sinGate. [por que] Solo glory-sentinel (el runtime) es elegible;
   * el endpoint no acepta claves arbitrarias. El proyecto sigue VISIBLE
   * (a diferencia de ignorados), solo fuerza puerta none sin problema
   * 'sin gate' en la consola. */
  if (ruta === '/api/config/singate') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as { op?: unknown; clave?: unknown };
    const op = body.op;
    const clave = typeof body.clave === 'string' ? body.clave : '';
    if ((op !== 'eximir' && op !== 'quitar') || clave !== 'glory-sentinel') {
      json(res, 400, { error: 'solo se puede eximir la clave real glory-sentinel' });
      return true;
    }
    try {
      const configNueva = cambiarSinGate(RAIZ_AREA, clave, op === 'eximir');
      const base = snapshotArea(false);
      const mutado: SnapshotWorkspace = { ...base.snapshot, config: configNueva };
      actualizarSnapshot(mutado);
      json(res, 200, { ok: true, config: configNueva, snapshot: mutado });
      return true;
    } catch (err) {
      json(res, 500, { error: 'No se pudo guardar la config', detalle: String(err) });
    }
    return true;
  }
  /* Config de escaneo automatico (plan A2): switch + intervalo. Se
   * persiste en la config del area (data/workspace.config.json). */
  if (ruta === '/api/config/scan') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    const body = (await leerBody(req)) as Partial<ConfigScan>;
    const actual = leerConfigArea(RAIZ_AREA).scan ?? { automatico: false, intervaloMin: 30 };
    const scan: ConfigScan = {
      automatico:
        typeof body.automatico === 'boolean' ? body.automatico : actual.automatico,
      intervaloMin:
        typeof body.intervaloMin === 'number' && body.intervaloMin > 0
          ? Math.min(Math.round(body.intervaloMin), 1440)
          : actual.intervaloMin,
    };
    const config = guardarConfigScan(RAIZ_AREA, scan);
    /* Aplica la config nueva al snapshot cacheado sin re-escandear. */
    const base = snapshotArea(false);
    const mutado: SnapshotWorkspace = { ...base.snapshot, config };
    actualizarSnapshot(mutado);
    json(res, 200, { ok: true, config });
    return true;
  }
  return false;
}
