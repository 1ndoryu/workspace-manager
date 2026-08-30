/* Servidor HTTP del workspace-manager: sirve la API JSON (escaneo del area)
 * y el build estatico del cliente. [por que] Node http nativo, sin framework:
 * rapido, cero deps, coherente con el stack ligero del proyecto. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join, normalize, relative, sep } from 'node:path';
import { obtenerSnapshot, actualizarSnapshot } from './cache.js';
import { escanearWorkspace, claveDe, resumenDe } from './scanner/workspace.js';
import { ARCHIVOS_GATE, doctorSentinel } from './scanner/gate.js';
import { cambiarIgnorado, guardarConfigScan, leerConfigArea } from './configArea.js';
import { esquemaGate, reglasGate } from './gate/proveedor.js';
import { analizarProyecto, analizarTodo, esElegible, leerAnalisis } from './gate/analizador.js';
import type { ConfigScan, SnapshotWorkspace } from '../shared/types.js';

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

/* Carpetas de ruido que no se listan en el navegador: internas de build,
 * dependencias y VCS. [por que] Navegar el area con node_modules/.git/target
 * al lado no aporta y ralentiza; el usuario pidio moverse entre carpetas
 * utiles del proyecto. */
const CARPETAS_OCULTAS = new Set([
  'node_modules', '.git', '.sentinel', 'target', 'dist', 'build', '.next',
  '.nuxt', '.cache', '.cargo', '.venv', 'venv', '__pycache__', '.idea',
]);

/* Limite de entradas a stat para mostrar tamanos; mas alla se omite el
 * tamano (evita statSync masivo en carpetas como node_modules). */
const MAX_STAT_ENTRADAS = 500;

/* Resuelve una ruta relativa al area dentro del area; null si escapa
 * (path traversal). [por que] El cliente solo envia rutas relativas; nunca
 * se acepta un path absoluto ni una subida fuera de la raiz. */
function resolverArea(rutaRel: string): string | null {
  const abs = normalize(join(RAÍZ_AREA, rutaRel));
  const rel = relative(normalize(RAÍZ_AREA), abs);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  return abs;
}

/* Directorio padre de una ruta relativa ('a/b' -> 'a'; '' -> ''). */
function padreDe(rutaRel: string): string {
  const idx = rutaRel.lastIndexOf('/');
  return idx <= 0 ? '' : rutaRel.slice(0, idx);
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
        /* Gate por proyecto: leer/editar los archivos de config (sentinel /
         * varsense). [por que] El panel de configuracion por proyecto muestra
         * el estado del gate y permite controlar sus reglas editando el JSON
         * real; la ruta se resuelve desde el snapshot por clave y el nombre
         * esta en whitelist (anti-traversal). */
        if (ruta === '/api/proyecto/gate') {
          const clave = url.searchParams.get('clave') ?? '';
          const { snapshot } = snapshotArea(false);
          const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
          if (!proyecto) {
            json(res, 404, { error: 'Proyecto no encontrado', clave });
            return;
          }
          if (req.method === 'GET') {
            const archivos = ARCHIVOS_GATE.map((n) => ({
              nombre: n,
              existe: existsSync(join(proyecto.ruta, n)),
            })).filter((a) => a.existe);
            /* [por que] JSON valido con comentarios: el JSON del gate puede
             * traer // y /* *\/ (JSONC). Para editarlo se envia el archivo
             * crudo; la validacion estricta solo se exige al escribir. */
            const contenidos = Object.fromEntries(
              archivos.map((a) => [a.nombre, leerArchivo(join(proyecto.ruta, a.nombre))]),
            );
            json(res, 200, { clave, estado: proyecto.gate, archivos, contenidos });
            return;
          }
          if (req.method === 'POST') {
            const body = (await leerBody(req)) as { nombre?: unknown; contenido?: unknown };
            const nombre = typeof body.nombre === 'string' ? body.nombre : '';
            const contenido = typeof body.contenido === 'string' ? body.contenido : null;
            if ((ARCHIVOS_GATE as readonly string[]).includes(nombre) === false || contenido === null) {
              json(res, 400, { error: 'archivo o contenido invalido' });
              return;
            }
            /* [por que] Validar JSON antes de escribir: no se permite romper
             * el gate de un proyecto con JSON invalido. Solo se exige
             * parseable (no se re-serializa, para no reformatear). */
            try {
              JSON.parse(contenido);
            } catch {
              json(res, 422, { error: 'JSON invalido', detalle: 'el contenido no es JSON valido' });
              return;
            }
            const ruta = join(proyecto.ruta, nombre);
            try {
              writeFileSync(ruta, contenido, 'utf8');
              try {
                snapshotArea(true);
              } catch (err) {
                console.warn('[gate] re-escaneo tras guardar fallo:', err);
              }
              json(res, 200, { ok: true, clave, nombre, ruta });
            } catch (err) {
              json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
            }
            return;
          }
          json(res, 405, { error: 'Metodo no permitido' });
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
        /* Catalogo de reglas VIVO del gate desde el runtime sentinel.
         * [por que] El cliente es 'tonto': no importa el snapshot de reglas
         * en el bundle, el server resuelve el runtime instalado y sirve las
         * reglas reales (con fallback al catalogo estatico embebido). */
        if (ruta === '/api/gate/reglas') {
          if (req.method !== 'GET') {
            json(res, 405, { error: 'Metodo no permitido' });
            return;
          }
          const { version, fuente, reglas } = reglasGate();
          json(res, 200, { version, fuente, total: reglas.length, reglas });
          return;
        }
        /* Esquema del gate DINAMICO (E1 gate-dinamico): sirve el esquema de
         * config de una herramienta (sentinel/varsense) + sus reglas + metadata
         * de version, resueltos por el server. El cliente es 'tonto': deja de
         * importar ESQUEMA_* estaticos en el bundle y pide todo aca. El esquema
         * va SERIALIZADO (ciclos resueltos a refs); el cliente lo rehidrata.
         * Nunca toca el JSON real de ningun proyecto. */
        if (ruta === '/api/gate/dinamico') {
          if (req.method !== 'GET') {
            json(res, 405, { error: 'Metodo no permitido' });
            return;
          }
          const tool = (url.searchParams.get('tool') ?? '') as 'sentinel' | 'varsense';
          if (tool !== 'sentinel' && tool !== 'varsense') {
            json(res, 400, { error: 'tool invalido (sentinel|varsense)' });
            return;
          }
          const r = esquemaGate(tool);
          if (!r) {
            json(res, 404, { error: `proveedor ${tool} no registrado` });
            return;
          }
          json(res, 200, {
            tool,
            metadatos: r.metadatos,
            esquema: JSON.parse(r.esquemaText) as unknown,
            reglas: r.metadatos.tipo === 'sentinel' ? reglasGate().reglas : [],
            totalReglas: r.totalReglas,
          });
          return;
        }
        /* Analisis real de sentinel por proyecto (plan analisis-sentinel-consola
         * A0/A1). [por que] El cliente es 'tonto' y este modulo es el dueno de
         * la ejecucion: nunca corre dentro del escaneo raiz (~2.6 s). La cache
         * por frescura (branch+HEAD+version) evita revert spawns sin cambios. */
        if (ruta === '/api/gate/analizar' || ruta === '/api/gate/analizar-todo') {
          if (req.method !== 'POST') {
            json(res, 405, { error: 'Metodo no permitido' });
            return;
          }
          const { snapshot } = snapshotArea(false);
          /* Un proyecto: body { clave, forzar? }. Solo si es elegible (sentinel). */
          if (ruta === '/api/gate/analizar') {
            const body = (await leerBody(req)) as { clave?: unknown; forzar?: unknown };
            const clave = typeof body.clave === 'string' ? body.clave : '';
            const forzar = body.forzar === true;
            const proyecto = snapshot.proyectos.find((p) => p.clave === clave);
            if (!proyecto) {
              json(res, 404, { error: 'Proyecto no encontrado', clave });
              return;
            }
            if (!esElegible(proyecto)) {
              json(res, 400, { error: 'El proyecto no usa sentinel (no se puede analizar)', clave });
              return;
            }
            json(res, 200, analizarProyecto(proyecto, forzar));
            return;
          }
          /* Todo el workspace: barrido serial de los elegibles. */
          const analisis = analizarTodo(snapshot.proyectos);
          json(res, 200, {
            escaneadoEn: new Date().toISOString(),
            proyectos: analisis,
          });
          return;
        }
        /* Cache de un analisis (para counts en la consola sin volcar hallazgos). */
        if (ruta === '/api/gate/analisis') {
          if (req.method !== 'GET') {
            json(res, 405, { error: 'Metodo no permitido' });
            return;
          }
          const clave = url.searchParams.get('clave') ?? '';
          json(res, 200, { clave, analisis: leerAnalisis(clave) });
          return;
        }
        /* Config del area: alternar un proyecto entre ignorar / dejar de
         * ignorar. La clave es la ruta relativa (no el nombre). */
        if (ruta === '/api/config') {
          if (req.method !== 'POST') {
            json(res, 405, { error: 'Metodo no permitido' });
            return;
          }
          const body = (await leerBody(req)) as { op?: unknown; clave?: unknown };
          const op = body.op;
          const clave = typeof body.clave === 'string' ? body.clave : '';
          if ((op !== 'ignorar' && op !== 'quitar') || clave === '') {
            json(res, 400, { error: 'op o clave invalidos' });
            return;
          }
          try {
            /* [por que] cambiarIgnorado persiste en disco y devuelve la config
             * nueva; se usa esa (no la del snapshot, que aun tiene la vieja). */
            const configNueva = cambiarIgnorado(RAÍZ_AREA, clave, op === 'ignorar');
            /* Mutacion en memoria del snapshot cacheado: ignorar/quitar solo
             * cambia la visibilidad (no git/gate/roadmap), asi que NO se
             * re-escanea (escaneo completo ~2.6s). [por que] El usuario pidio
             * que el cambio se refleje en tiempo real; re-escandear aqui y
             * luego otra vez en el cliente duplicaba la latencia. */
            const base = snapshotArea(false);
            const ignoradoSet = new Set(configNueva.ignorados);
            const proyectos = base.snapshot.proyectos
              .map((p) => ({ ...p, clave: claveDe(p.ruta, RAÍZ_AREA) }))
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
            return;
          } catch (err) {
            json(res, 500, { error: 'No se pudo guardar la config', detalle: String(err) });
          }
          return;
        }
        /* Config de escaneo automatico (plan A2): switch + intervalo. Se
         * persiste en la config del area (data/workspace.config.json). */
        if (ruta === '/api/config/scan') {
          if (req.method !== 'POST') {
            json(res, 405, { error: 'Metodo no permitido' });
            return;
          }
          const body = (await leerBody(req)) as Partial<ConfigScan>;
          const actual = leerConfigArea(RAÍZ_AREA).scan ?? { automatico: false, intervaloMin: 30 };
          const scan: ConfigScan = {
            automatico:
              typeof body.automatico === 'boolean' ? body.automatico : actual.automatico,
            intervaloMin:
              typeof body.intervaloMin === 'number' && body.intervaloMin > 0
                ? Math.min(Math.round(body.intervaloMin), 1440)
                : actual.intervaloMin,
          };
          const config = guardarConfigScan(RAÍZ_AREA, scan);
          /* Aplica la config nueva al snapshot cacheado sin re-escandear. */
          const base = snapshotArea(false);
          const mutado: SnapshotWorkspace = { ...base.snapshot, config };
          actualizarSnapshot(mutado);
          json(res, 200, { ok: true, config });
          return;
        }
        if (ruta.startsWith('/api/skills/')) {
          /* Contenido y escritura de una skill global. [por que] La ruta se
           * resuelve desde el snapshot por nombre (nunca se acepta un path
           * del cliente): evita traversal fuera de la carpeta de skills. */
          const nombre = decodeURIComponent(ruta.slice('/api/skills/'.length));
          const { snapshot } = snapshotArea(false);
          const skill = snapshot.agentes.skills.find(s => s.nombre === nombre);
          if (!skill) {
            json(res, 404, { error: 'Skill no encontrada', nombre });
            return;
          }
          if (req.method === 'GET') {
            const contenido = leerArchivo(skill.ruta);
            if (contenido === null) {
              json(res, 404, { error: 'SKILL.md no legible', nombre });
              return;
            }
            json(res, 200, { nombre, ruta: skill.ruta, contenido });
            return;
          }
          /* POST: sobrescribir el SKILL.md, mismo transporte que /api/agentes. */
          if (req.method === 'POST') {
            const body = (await leerBody(req)) as { contenido?: unknown };
            const contenido = typeof body.contenido === 'string' ? body.contenido : null;
            if (contenido === null) {
              json(res, 400, { error: 'Contenido invalido' });
              return;
            }
            try {
              writeFileSync(skill.ruta, contenido, 'utf8');
              /* [por que] La escritura ya tuvo exito; el re-escaneo es
               * best-effort y NO debe convertir el guardado en un 500 si
               * falla (p. ej. un repo con un git lock). Se reporta solo en
               * el log del servidor. */
              try {
                snapshotArea(true);
              } catch (err) {
                console.warn('[skills] re-escaneo tras guardar fallo:', err);
              }
              json(res, 200, { ok: true, nombre, ruta: skill.ruta });
            } catch (err) {
              json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
            }
            return;
          }
          json(res, 405, { error: 'Metodo no permitido' });
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
              /* [por que] Re-escaneo best-effort y separado de la escritura:
               * si falla, la escritura igual es exitosa y se responde 200;
               * solo se loguea, sin convertir el guardado en un error. */
              try {
                snapshotArea(true);
              } catch (err) {
                console.warn('[agentes] re-escaneo tras guardar fallo:', err);
              }
              json(res, 200, { ok: true, id, ruta });
            } catch (err) {
              json(res, 500, { error: 'No se pudo escribir', detalle: String(err) });
            }
            return;
          }
          json(res, 405, { error: 'Metodo no permitido' });
          return;
        }
        if (ruta === '/api/archivos' || ruta.startsWith('/api/archivos/')) {
          const sub = ruta.slice('/api/archivos'.length);
          const rutaRel = url.searchParams.get('ruta') ?? '';
          /* GET /api/archivos?ruta=<rel>: listado de un directorio. */
          if (sub === '' || sub === '/') {
            if (req.method !== 'GET') {
              json(res, 405, { error: 'Metodo no permitido' });
              return;
            }
            const dir = resolverArea(rutaRel);
            if (dir === null) {
              json(res, 400, { error: 'Ruta fuera del area de trabajo', ruta: rutaRel });
              return;
            }
            if (!existsSync(dir) || !statSync(dir).isDirectory()) {
              json(res, 404, { error: 'Directorio no encontrado', ruta: rutaRel });
              return;
            }
            const entradasRaw = readdirSync(dir, { withFileTypes: true });
            const conTamano = entradasRaw.length <= MAX_STAT_ENTRADAS;
            const entradas = entradasRaw
              .filter((d) => !CARPETAS_OCULTAS.has(d.name))
              .map((d) => {
                const esCarpeta = d.isDirectory();
                const ruta = rutaRel ? `${rutaRel}/${d.name}` : d.name;
                let tamano: number | null = null;
                if (!esCarpeta && conTamano) {
                  try {
                    tamano = statSync(join(dir, d.name)).size;
                  } catch {
                    tamano = null;
                  }
                }
                return { nombre: d.name, ruta, tipo: esCarpeta ? 'carpeta' : 'archivo', tamano };
              })
              .sort((a, b) =>
                a.tipo === b.tipo
                  ? a.nombre.localeCompare(b.nombre)
                  : a.tipo === 'carpeta'
                    ? -1
                    : 1,
              );
            json(res, 200, { ruta: rutaRel, padre: padreDe(rutaRel), entradas });
            return;
          }
          /* GET /api/archivos/contenido?ruta=<rel>: contenido de un archivo. */
          if (sub === '/contenido') {
            if (req.method !== 'GET') {
              json(res, 405, { error: 'Metodo no permitido' });
              return;
            }
            const archivo = resolverArea(rutaRel);
            if (archivo === null) {
              json(res, 400, { error: 'Ruta fuera del area de trabajo', ruta: rutaRel });
              return;
            }
            if (!existsSync(archivo) || !statSync(archivo).isFile()) {
              json(res, 404, { error: 'Archivo no encontrado', ruta: rutaRel });
              return;
            }
            const tam = statSync(archivo).size;
            if (tam > 1_000_000) {
              json(res, 413, { error: 'Archivo demasiado grande para previsualizar', tamano: tam });
              return;
            }
            const contenido = leerArchivo(archivo);
            if (contenido === null) {
              json(res, 500, { error: 'No se pudo leer el archivo', ruta: rutaRel });
              return;
            }
            /* Detecta binarios por byte NUL: no se pueden mostrar como texto. */
            const binario = contenido.includes('\u0000');
            json(res, 200, {
              ruta: rutaRel,
              nombre: basename(archivo),
              binario,
              contenido: binario ? null : contenido,
            });
            return;
          }
          json(res, 404, { error: 'Subruta de archivos desconocida', sub });
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
