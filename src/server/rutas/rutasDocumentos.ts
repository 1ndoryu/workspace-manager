/* Rutas de documentos (/api/skills/*, /api/agentes): leer y escribir SKILL.md
 * globales y AGENTS.md (global o por proyecto). [por que] Extraido de
 * `index.ts` (limite-lineas): es el dominio "documentos". La ruta del archivo
 * siempre se resuelve desde el snapshot (por nombre/id), nunca se acepta un
 * path del cliente (anti-traversal). Devuelve true si atendio la ruta. */
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { campoStr, json, leerArchivo, leerBody } from '../http.js';
import { RAIZ_AREA } from '../plataforma/rutas.js';
import { snapshotArea } from '../snapshot.js';
import { guardarYRefrescar } from './escritura/guardarArchivo.js';

export async function manejarRutasDocumentos(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  if (ruta.startsWith('/api/skills/')) {
    /* Contenido y escritura de una skill global. [por que] La ruta se
     * resuelve desde el snapshot por nombre (nunca se acepta un path
     * del cliente): evita traversal fuera de la carpeta de skills. */
    const nombre = decodeURIComponent(ruta.slice('/api/skills/'.length));
    const { snapshot } = await snapshotArea(false);
    const skill = snapshot.agentes.skills.find(s => s.nombre === nombre);
    if (!skill) {
      json(res, 404, { error: 'Skill no encontrada', nombre });
      return true;
    }
    if (req.method === 'GET') {
      const contenido = leerArchivo(skill.ruta);
      if (contenido === null) {
        json(res, 404, { error: 'SKILL.md no legible', nombre });
        return true;
      }
      json(res, 200, { nombre, ruta: skill.ruta, contenido });
      return true;
    }
    /* POST: sobrescribir el SKILL.md, mismo transporte que /api/agentes. */
    if (req.method === 'POST') {
      const body = (await leerBody(req)) as { contenido?: unknown };
      const contenido = campoStr(body, 'contenido', null);
      if (contenido === null) {
        json(res, 400, { error: 'Contenido invalido' });
        return true;
      }
      try {
        /* El re-escaneo es best-effort: no convierte el guardado en 500 (ver guardarArchivo.ts). */
        await guardarYRefrescar(skill.ruta, contenido, 'skills');
        json(res, 200, { ok: true, nombre, ruta: skill.ruta });
      } catch (err) {
        json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
      }
      return true;
    }
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  if (ruta === '/api/agentes') {
    /* GET: contenido de AGENTS.md (proyecto por id o 'raiz'). */
    if (req.method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      const { snapshot } = await snapshotArea(false);
      const proyecto = snapshot.proyectos.find(p => p.id === id);
      const rutaAgents =
        id === 'raiz'
          ? snapshot.agentes.global.ruta
          : proyecto
            ? join(proyecto.ruta, 'AGENTS.md')
            : null;
      if (!rutaAgents) {
        json(res, 404, { error: 'Sin AGENTS.md para el id', id });
        return true;
      }
      const contenido = leerArchivo(rutaAgents);
      if (contenido === null) {
        json(res, 404, { error: 'AGENTS.md no encontrado', id });
        return true;
      }
      json(res, 200, { id, ruta: rutaAgents, contenido });
      return true;
    }
    /* POST: crear/actualizar AGENTS.md de un proyecto o la raiz.
     * [por que] El panel de documentacion gestiona agents.md; la ruta
     * tambien se resuelve desde el snapshot por id, nunca del cliente. */
    if (req.method === 'POST') {
      const body = (await leerBody(req)) as { id?: unknown; contenido?: unknown };
      const id = campoStr(body, 'id', '');
      const contenido = campoStr(body, 'contenido', null);
      if (contenido === null) {
        json(res, 400, { error: 'Contenido invalido' });
        return true;
      }
      const { snapshot } = await snapshotArea(false);
      const proyecto = snapshot.proyectos.find(p => p.id === id);
      const rutaAgents =
        id === 'raiz'
          ? join(RAIZ_AREA, 'AGENTS.md')
          : proyecto
            ? join(proyecto.ruta, 'AGENTS.md')
            : null;
      if (!rutaAgents) {
        json(res, 404, { error: 'Proyecto no encontrado', id });
        return true;
      }
      try {
        await guardarYRefrescar(rutaAgents, contenido, 'agentes');
        json(res, 200, { ok: true, id, ruta: rutaAgents });
      } catch (err) {
        json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
      }
      return true;
    }
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  return false;
}
