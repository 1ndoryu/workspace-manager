/* Servidor HTTP del workspace-manager: sirve la API JSON (escaneo del area)
 * y el build estatico del cliente. [por que] Node http nativo, sin framework:
 * rapido, cero deps, coherente con el stack ligero del proyecto. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { obtenerSnapshot } from './cache.js';
import { escanearWorkspace } from './scanner/workspace.js';
import { doctorSentinel } from './scanner/gate.js';

export const RAÍZ_AREA = process.env.WS_AREA_ROOT || 'C:/Users/Owner/OneDrive/Documentos/area-trabajo';
export const CARPETA_SKILLS = process.env.WS_SKILLS_ROOT || 'C:/Users/Owner/.agents/skills';
export const PUERTO = Number(process.env.WS_PORT) || 8787;

/* [por que] resolver DIST relativo al script y no al cwd: el servidor puede
 * arrancarse desde cualquier directorio (p. ej. scripts o el wrapper). */
const DIST = join(import.meta.dirname, '..', '..', 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/* Lee el body JSON de un POST. [por que] Node http nativo no parsea bodies;
 * el unico POST del API es /api/agentes, asi que el parseo es minimalista. */
function leerBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (c) => {
      datos += c;
      if (datos.length > 1_000_000) {
        req.destroy();
        reject(new Error('Body demasiado grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(datos.length > 0 ? JSON.parse(datos) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/* Lee el contenido de un archivo; null si no existe o falla. */
function leerArchivo(ruta: string): string | null {
  try {
    if (!existsSync(ruta)) return null;
    return readFileSync(ruta, 'utf8');
  } catch {
    return null;
  }
}

/* Escaner con cache; el flag `forzar` re-escanea. */
function snapshotArea(forzar: boolean) {
  return obtenerSnapshot(
    RAÍZ_AREA,
    () => escanearWorkspace({ raiz: RAÍZ_AREA, carpetaSkills: CARPETA_SKILLS }),
    forzar,
  );
}

/* Sirve archivos estaticos del build (dist) o del index.html. */
function servirEstatico(rutaRel: string, res: ServerResponse): void {
  const ruta = normalize(join(DIST, rutaRel));
  if (!ruta.startsWith(normalize(DIST))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  let archivo = ruta;
  if (!existsSync(archivo) || statSync(archivo).isDirectory()) {
    archivo = join(DIST, 'index.html');
  }
  if (!existsSync(archivo)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const tipo = MIME[extname(archivo)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': tipo });
  res.end(readFileSync(archivo));
}

export function crearServidor() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const ruta = url.pathname;

    if (ruta.startsWith('/api/')) {
      try {
        if (ruta === '/api/workspace') {
          const forzar = url.searchParams.get('forzar') === '1';
          const { snapshot, desdeCache } = snapshotArea(forzar);
          json(res, 200, { ...snapshot, desdeCache });
          return;
        }
        if (ruta === '/api/proyectos') {
          const { snapshot } = snapshotArea(false);
          json(res, 200, snapshot.proyectos);
          return;
        }
        if (ruta === '/api/proyectos/doctor') {
          const id = url.searchParams.get('id') ?? '';
          const { snapshot } = snapshotArea(false);
          const proyecto = snapshot.proyectos.find(p => p.id === id || p.ruta.endsWith(id));
          if (!proyecto) {
            json(res, 404, { error: 'Proyecto no encontrado', id });
            return;
          }
          const doctor = doctorSentinel(proyecto.ruta);
          json(res, 200, { id, doctor });
          return;
        }
        if (ruta.startsWith('/api/skills/')) {
          /* Contenido de una skill global. [por que] La ruta se resuelve
           * desde el snapshot por nombre (nunca se acepta un path del
           * cliente): evita traversal fuera de la carpeta de skills. */
          const nombre = decodeURIComponent(ruta.slice('/api/skills/'.length));
          const { snapshot } = snapshotArea(false);
          const skill = snapshot.agentes.skills.find(s => s.nombre === nombre);
          if (!skill) {
            json(res, 404, { error: 'Skill no encontrada', nombre });
            return;
          }
          const contenido = leerArchivo(skill.ruta);
          if (contenido === null) {
            json(res, 404, { error: 'SKILL.md no legible', nombre });
            return;
          }
          json(res, 200, { nombre, ruta: skill.ruta, contenido });
          return;
        }
        if (ruta === '/api/agentes') {
          /* GET: contenido de AGENTS.md (proyecto por id o 'raiz'). */
          if (req.method === 'GET') {
            const id = url.searchParams.get('id') ?? '';
            const { snapshot } = snapshotArea(false);
            const proyecto = snapshot.proyectos.find(p => p.id === id);
            const ruta =
              id === 'raiz'
                ? snapshot.agentes.global.ruta
                : proyecto
                  ? join(proyecto.ruta, 'AGENTS.md')
                  : null;
            if (!ruta) {
              json(res, 404, { error: 'Sin AGENTS.md para el id', id });
              return;
            }
            const contenido = leerArchivo(ruta);
            if (contenido === null) {
              json(res, 404, { error: 'AGENTS.md no encontrado', id });
              return;
            }
            json(res, 200, { id, ruta, contenido });
            return;
          }
          /* POST: crear/actualizar AGENTS.md de un proyecto o la raiz.
           * [por que] El panel de documentacion gestiona agents.md; la ruta
           * tambien se resuelve desde el snapshot por id, nunca del cliente. */
          if (req.method === 'POST') {
            const body = (await leerBody(req)) as { id?: unknown; contenido?: unknown };
            const id = typeof body.id === 'string' ? body.id : '';
            const contenido = typeof body.contenido === 'string' ? body.contenido : null;
            if (contenido === null) {
              json(res, 400, { error: 'Contenido invalido' });
              return;
            }
            const { snapshot } = snapshotArea(false);
            const proyecto = snapshot.proyectos.find(p => p.id === id);
            const ruta =
              id === 'raiz'
                ? join(RAÍZ_AREA, 'AGENTS.md')
                : proyecto
                  ? join(proyecto.ruta, 'AGENTS.md')
                  : null;
            if (!ruta) {
              json(res, 404, { error: 'Proyecto no encontrado', id });
              return;
            }
            try {
              writeFileSync(ruta, contenido, 'utf8');
              /* Re-escaneo forzado: el AGENTS.md nuevo cambia el resumen
               * (tieneAgentsMd/reglas) y posiblemente el estado git. */
              snapshotArea(true);
              json(res, 200, { ok: true, id, ruta });
            } catch (err) {
              json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
            }
            return;
          }
          json(res, 405, { error: 'Metodo no permitido' });
          return;
        }
        json(res, 404, { error: 'Ruta no encontrada', ruta });
        return;
      } catch (err) {
        json(res, 500, { error: 'Error interno', detalle: String(err) });
        return;
      }
    }

    if (req.method === 'GET') {
      servirEstatico(ruta, res);
      return;
    }

    json(res, 405, { error: 'Metodo no permitido' });
  });
}

/* Modo servidor directo: `node src/server/index.ts` levanta la API. */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const servidor = crearServidor();
  servidor.listen(PUERTO, '127.0.0.1', () => {
    console.log(`[workspace-manager] API escuchando en http://127.0.0.1:${PUERTO}`);
  });
}
