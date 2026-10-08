/* Servidor HTTP del workspace-manager: sirve la API JSON (escaneo del area)
 * y el build estatico del cliente. [por que] Node http nativo, sin framework:
 * rapido, cero deps, coherente con el stack ligero del proyecto. */
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { json } from './http.js';
import { obtenerSnapshot } from './cache.js';
import { escanearWorkspace } from './scanner/workspace.js';
import { manejarRutasGate } from './rutas/rutasGate.js';
import { manejarRutasGuard } from './guard/rutasGuard.js';
import { manejarRutasConfig } from './rutas/rutasConfig.js';
import { manejarRutasDocumentos } from './rutas/rutasDocumentos.js';
import { manejarRutasArchivos } from './rutas/rutasArchivos.js';
import { manejarRutasPc } from './rutas/rutasPc.js';
import { manejarRutasDev } from './rutas/rutasDev.js';
import { manejarRutasConsola } from './rutas/rutasConsola.js';
import { manejarRutasRepos } from './rutas/rutasRepos.js';
import { manejarRutasVps } from './vps/rutas/rutasVps.js';
import { manejarRutasVpsHistorial } from './vps/rutas/rutasVpsHistorial.js';
import { manejarRutasVpsPiezas } from './vps/rutas/rutasVpsPiezas.js';
import { crearManejadorTareas } from './tareas/rutasTareas.js';
import { logger } from '../shared/logger.js';

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

/* Escaner con cache; el flag `forzar` re-escanea. */
function snapshotArea(forzar: boolean) {
  return obtenerSnapshot(
    RAÍZ_AREA,
    () => escanearWorkspace({ raiz: RAÍZ_AREA, carpetaSkills: CARPETA_SKILLS }),
    forzar,
  );
}

/* Proxy tareas con las columnas del snapshot (08AA-6 sync): instancia unica;
 * `snapshotArea(false)` sirve cache sin escanear (la columna nueva aparece
 * tras el siguiente escaneo). */
const manejarTareas = crearManejadorTareas({
  leerWm: () => snapshotArea(false).snapshot.proyectos.map((p) => ({clave: p.clave, nombre: p.id})),
});

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
        /* Rutas del gate (/api/proyecto/gate, /api/proyectos/doctor,
         * /api/gate/*): viven en rutasGate.ts (dominio gate). */
        if (await manejarRutasGate(req, res, url, ruta)) {
          return;
        }
        /* Rutas del Guard del tope físico anti-espiral (/api/guard/*, 07AA-6
         * F6): estado por proyecto + control modo/lote-extra. */
        if (await manejarRutasGuard(req, res, url, ruta)) {
          return;
        }
        /* Rutas de config (/api/config*): viven en rutasConfig.ts. */
        if (await manejarRutasConfig(req, res, url, ruta)) {
          return;
        }
        /* Rutas de documentos (/api/skills/*, /api/agentes): viven en
         * rutasDocumentos.ts. */
        if (await manejarRutasDocumentos(req, res, url, ruta)) {
          return;
        }
        /* Rutas del navegador de archivos (/api/archivos*): viven en
         * rutasArchivos.ts. */
        if (await manejarRutasArchivos(req, res, url, ruta)) {
          return;
        }
        /* Rutas de la tab repos (/api/repos/*): viven en rutasRepos.ts. */
        if (await manejarRutasRepos(req, res, url, ruta)) {
          return;
        }
        /* Rutas de la tab vps (/api/vps/*, 299A-5, solo lectura via
         * coolify-manager-rs): viven en vps/rutas/rutasVps.ts. */
        if (await manejarRutasVps(req, res, url, ruta)) {
          return;
        }
        /* Piezas pesadas bajo demanda (/api/vps/pieza, 0110A-3 F3):
         * archivo aparte para no chocar con el refactor de rutasVps. */
        if (await manejarRutasVpsPiezas(req, res, url, ruta)) {
          return;
        }
        /* Historial persistente por despliegue (/api/vps/historial, 07AA-4):
         * archivo aparte para no engordar rutasVps (límite de líneas). */
        if (await manejarRutasVpsHistorial(req, res, url, ruta)) {
          return;
        }
        /* Rutas de la tab PC (/api/pc/*): viven en rutasPc.ts. */
        if (await manejarRutasPc(req, res, url, ruta)) {
          return;
        }
        /* Rutas del mando dev (/api/dev/*, F0b): viven en rutasDev.ts. */
        if (await manejarRutasDev(req, res, url, ruta)) {
          return;
        }
        /* Consola de problemas agregada (/api/consola/*, 07AA-1): mismo
         * conteo que la cabecera, con desglose. Viven en rutasConsola.ts. */
        if (await manejarRutasConsola(req, res, url, ruta)) {
          return;
        }
        /* Proxy de la tab tareas (/api/tareas/*, 07AA-5 F2): el front no
         * toca TASKS; el puente custodia la sesion D1 en el servidor. */
        if (await manejarTareas(req, res, url, ruta)) {
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
    logger.log(`API escuchando en http://127.0.0.1:${PUERTO}`);
  });
}
