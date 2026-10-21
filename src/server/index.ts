/* Servidor HTTP del workspace-manager: sirve la API JSON (escaneo del area)
 * y el build estatico del cliente. [por que] Node http nativo, sin framework:
 * rapido, cero deps, coherente con el stack ligero del proyecto. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { json } from './http.js';
import { RAIZ_DATOS, RAIZ_REPO } from './plataforma/rutas.js';
/* [por que] `snapshotArea` vive en snapshot.ts desde que se extrajo alli por
 * limite de lineas; tener aqui una copia era una segunda fuente de verdad del
 * mismo escaneo (y arrastraba estos imports). */
import { alEscanearWorkspace, snapshotArea } from './snapshot.js';
import { manejarRutasGate } from './rutas/rutasGate.js';
import { manejarRutasAlta } from './rutas/rutasAlta.js';
import { manejarRutasGuardian } from './rutas/guardian/rutasGuardian.js';
import { manejarRutasConfig } from './rutas/rutasConfig.js';
import { manejarRutasDocumentos } from './rutas/rutasDocumentos.js';
import { manejarRutasArchivos } from './rutas/rutasArchivos.js';
import { manejarRutasPc } from './rutas/rutasPc.js';
import { manejarRutasDev } from './rutas/rutasDev.js';
import { manejarRutasConsola } from './rutas/rutasConsola.js';
import { manejarRutasTaller } from './taller/rutasTaller.js';
import { estadoTaller } from './taller/estado.js';
import { arrancarSupervisor } from './taller/tuneles.js';
import { manejarRutasTallerAgente } from './taller/rutasTallerAgente.js';
import { manejarRutasSalud } from './rutas/salud/rutasSalud.js';
import { manejarRutasRepos } from './rutas/rutasRepos.js';
import { manejarRutasVps } from './vps/rutas/rutasVps.js';
import { manejarRutasVpsHistorial } from './vps/rutas/rutasVpsHistorial.js';
import { manejarRutasRecursos } from './recursos/rutasRecursos.js';
import { muestreadorProd } from './recursos/muestreador.js';
import { manejarRutasVpsPiezas } from './vps/rutas/rutasVpsPiezas.js';
import { crearManejadorTareas } from './tareas/rutasTareas.js';
import { puenteTareas } from './tareas/puente-tareas.js';
import { crearSincroniaFondo } from './tareas/sincronizacion/sincronia-fondo.js';
import { crearServicioNotificaciones } from './notificaciones/notificaciones.js';
import { fuentesReales } from './notificaciones/componer.js';
import { crearManejadorNotificaciones } from './notificaciones/rutasNotificaciones.js';
import { verificarEntrada } from './seguridad/entrada.js';
import { obtenerToken } from './seguridad/token.js';
import { registrarAuditoria, rutaAuditoriaPorDefecto } from './seguridad/auditoria.js';
import { logger } from '../shared/logger.js';

import { PUERTO_API } from './plataforma/sistema/puertos.js';
export const PUERTO = PUERTO_API;

/* [por que] resolver DIST relativo al script y no al cwd: el servidor puede
 * arrancarse desde cualquier directorio (p. ej. scripts o el wrapper). */
const DIST = join(RAIZ_REPO, 'dist');
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

/* Proyectos del workspace con su carpeta: la sincronizacion del roadmap (20AA-10) la necesita
 * para leer el `roadmap.md` de cada uno. Cacheada a proposito (`false`): lo que hay que leer
 * fresco es el archivo, y eso lo hace la sincronizacion; el snapshot solo da la lista. */
const leerProyectos = async () =>
  (await snapshotArea(false)).snapshot.proyectos.map((p) => ({clave: p.clave, nombre: p.id, ruta: p.ruta}));

/* Sincronia automatica roadmap <-> TASK (20AA-10 F6): una sola instancia para todo el proceso,
 * porque «una pasada a la vez» solo vale si quien la dispara desde un escaneo y quien la dispara
 * desde un gesto del tab comparten el mismo estado. */
const sincronia = crearSincroniaFondo({proyectos: leerProyectos, puente: puenteTareas});
/* El ciclo de escaneo es el disparador de fondo: cada escaneo de verdad (el del auto-timer, el
 * del boton, el que sigue a guardar un archivo) mira los roadmaps y pone al dia TASK. */
/* Campana de avisos (20AA-25): un servicio para todo el proceso. Se engancha a los mismos
 * momentos que la sincronia —fin de un escaneo real y los gestos del tab—; su propio latido solo
 * existe mientras haya una pestana escuchando. */
const notificaciones = crearServicioNotificaciones({
  rutaFichero: join(RAIZ_DATOS, 'cache', 'notificaciones.json'),
  fuentes: fuentesReales(),
});
alEscanearWorkspace(() => {
  sincronia.programar();
  notificaciones.programar();
});
/* Al arrancar: una pasada para tener línea base y la foto de ahora. `void`: no bloquea el
 * servidor, y el primer acceso a la campana la enseña en cuanto termine. */
void notificaciones.correr();
const manejarNotificaciones = crearManejadorNotificaciones(notificaciones);

/* Proxy tareas con las columnas del snapshot (08AA-6 sync): instancia unica;
 * `snapshotArea(false)` sirve cache sin escanear (la columna nueva aparece
 * tras el siguiente escaneo). */
const manejarTareas = crearManejadorTareas({
  leerWm: async () => (await snapshotArea(false)).snapshot.proyectos.map((p) => ({clave: p.clave, nombre: p.id})),
  leerProyectos,
  /* Las acciones del tab tambien disparan una pasada: lo que se acaba de escribir en el archivo
   * tiene que llegar a TASK sin esperar al siguiente escaneo. Y la campana mira lo mismo: un
   * gesto puede completar una tarea. */
  sincronia,
  alGesto: () => notificaciones.programar(),
});

type ManejadorRuta = (req: IncomingMessage, res: ServerResponse, url: URL, ruta: string) => Promise<boolean>;

/* Rutas de la API por dominio, en orden: la primera que reclama la ruta (devuelve true) responde.
 * [por que] Una tabla en vez de una cadena de `if`: añadir un dominio es una línea y el orden
 * queda a la vista. Cada módulo vive en su archivo; aquí solo se enumeran. */
const MANEJADORES_API: ManejadorRuta[] = [
  manejarRutasGate,         /* /api/proyecto/gate, /api/proyectos/doctor, /api/gate/* */
  manejarRutasAlta,         /* lista de alta por proyecto (10AA-2 F10) */
  manejarRutasGuardian,     /* /api/guardian/* (10AA-2 F11.4) */
  manejarRutasConfig,       /* /api/config* */
  manejarRutasDocumentos,   /* /api/skills/*, /api/agentes */
  manejarRutasArchivos,     /* /api/archivos* */
  manejarRutasRepos,        /* /api/repos/* */
  manejarRutasVps,          /* /api/vps/* (299A-5, solo lectura) */
  manejarRutasVpsPiezas,    /* /api/vps/pieza (0110A-3 F3): archivo aparte por el refactor de rutasVps */
  manejarRutasVpsHistorial, /* /api/vps/historial (07AA-4): archivo aparte por el límite de líneas */
  manejarRutasRecursos,     /* /api/recursos/historial (20AA-17) */
  manejarRutasPc,           /* /api/pc/* */
  manejarRutasDev,          /* /api/dev/* (F0b) */
  manejarRutasConsola,      /* /api/consola/* (07AA-1) */
  manejarRutasTaller,       /* /api/taller/estado (S3) */
  manejarRutasTallerAgente, /* /api/taller/agente y /api/taller/pieza (20AA-16) */
  manejarRutasSalud,        /* /api/salud/* (10AA-2 F8) */
  manejarNotificaciones,    /* /api/notificaciones* (20AA-25): campana y canal SSE */
  manejarTareas,            /* /api/tareas/* (07AA-5 F2): el puente custodia la sesión D1 */
];

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

export interface OpcionesServidor {
  /* Inyectables para tests; en producción salen del entorno y del archivo de usuario. */
  token?: string;
  /* null = sin auditoría. */
  auditoria?: string | null;
}

export function crearServidor(opciones: OpcionesServidor = {}) {
  const token = opciones.token ?? obtenerToken();
  const archivoAuditoria = opciones.auditoria === undefined
    ? rutaAuditoriaPorDefecto(RAIZ_REPO)
    : opciones.auditoria;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const ruta = url.pathname;

    /* Guardia de entrada (F9.1) antes de cualquier ruta: Host, Origin y token de la API. */
    if (archivoAuditoria !== null && ruta.startsWith('/api/')) {
      res.on('finish', () => {
        const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
        registrarAuditoria(archivoAuditoria, { metodo: req.method, ruta, estado: res.statusCode, origin });
      });
    }
    const veredicto = verificarEntrada(ruta, req.headers, token);
    if (!veredicto.ok) {
      json(res, veredicto.status, { error: veredicto.motivo });
      return;
    }

    if (ruta.startsWith('/api/')) {
      try {
        /* Lecturas del tablero: solo GET. Sin esta comprobación un POST a la sonda
         * (pública, sin token) o a una lectura respondía como si fuera GET. */
        if (['/api/ping', '/api/workspace', '/api/proyectos'].includes(ruta) && req.method !== 'GET') {
          json(res, 405, { error: 'Método no permitido' });
          return;
        }
        /* Sonda de vida sin token (única ruta pública de la API, ver seguridad/entrada.ts). */
        if (ruta === '/api/ping') {
          json(res, 200, { ok: true });
          return;
        }
        if (ruta === '/api/workspace') {
          const forzar = url.searchParams.get('forzar') === '1';
          const { snapshot, desdeCache } = await snapshotArea(forzar);
          json(res, 200, { ...snapshot, desdeCache });
          return;
        }
        if (ruta === '/api/proyectos') {
          const { snapshot } = await snapshotArea(false);
          json(res, 200, snapshot.proyectos);
          return;
        }
        /* Primera ruta de dominio que la reclama; si ninguna, 404. */
        for (const manejar of MANEJADORES_API) {
          if (await manejar(req, res, url, ruta)) return;
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
  /* Muestreo de fondo del historial de recursos (20AA-17). [por que aquí y no dentro de
   * crearServidor] Las pruebas montan el servidor con crearServidor: un temporizador ahí
   * dentro muestrearía en los tests y escribiría en el fichero real. */
  muestreadorProd().arrancar();
  /* Protocolo de estado permanente (2026-10-21): el túnel del portátil de los proyectos
   * `permanente` se rearma solo cada minuto, sin depender de que haya una pestaña abierta.
   * [por que aquí y no en crearServidor] Las pruebas montan el servidor con crearServidor: ahí
   * dentro el supervisor lanzaría `up` reales sobre el taller. */
  arrancarSupervisor({tmuxVivos: async () => (await estadoTaller(false)).entrada.t89?.tmux ?? []});
  const servidor = crearServidor();
  servidor.listen(PUERTO, '127.0.0.1', () => {
    logger.log(`API escuchando en http://127.0.0.1:${PUERTO}`);
  });
}
