/* Lectura de datos para la salud (10AA-2 F8). Único punto con I/O de disco y Git. Las
 * variables y rutas del equipo llegan por `Entorno` (entorno.ts). Las comprobaciones
 * (comprobacionesProyecto/Area) solo juzgan lo que aquí se lee.
 * [por que] La medición de C:\tmp es asíncrona y con presupuesto de tiempo: recorrer
 * targets de cargo de varios GB de forma síncrona bloquearía el servidor. */
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { join, parse } from 'node:path';
import type { Proyecto } from '../../shared/types.js';
import { leerArchivo } from '../http.js';
import { leerSentinelLock } from '../scanner/gate.js';
import { analizarRoadmap } from '../scanner/roadmap/roadmap.js';
import { PUERTO_GIT, type PuertoGit } from '../scanner/git.js';
import { diferenciasPlantilla, leerPolitica } from '../guardian/configuracion/politica.js';
import type { LecturaPlantilla } from '../guardian/configuracion/plantilla.js';
import type { DatosArea, DatosProyecto, EstadoGuard, PlanActivo, RamaSuelta } from './tipos.js';
import type { Entorno } from './entorno.js';
import { medirTmp } from './recoger/tmp.js';
import { copiasSkill, skillArranque } from './recoger/skill.js';
import { abiertasDelPlan, encabezados } from './recoger/puro.js';
export { abiertasDelPlan } from './recoger/puro.js';

const GB = 1024 ** 3;
/* [por que] Presupuesto de la medición de C:\tmp: `du` tarda minutos; el tablero no
 * puede esperar eso. Si se corta, la comprobación lo dice (`parcial`). */
/* [por que] C:\tmp tiene ~8 GB en decenas de miles de ficheros: 8 s cortaba la medición (parcial, siempre). La
 * medición es async y la salud tiene caché de 60 s; 60 s la completa sin bloquear el servidor. */
const PRESUPUESTO_TMP_MS = 60_000;
const DOCS_PROHIBIDOS = ['AGENTS.md', 'CLAUDE.md'];
/* Carpetas de compilación que no deben existir dentro del árbol del proyecto. */
const CARPETAS_COMPILACION = ['target', '.runtime/target'];
const FICHEROS_ENTORNO = ['.cargo/config.toml', '.cargo/config', '.env', '.env.local'];
const RE_INCREMENTAL_0 = /CARGO_INCREMENTAL\s*=\s*"?0"?(?![0-9])/;

function leerJson(ruta: string): Record<string, unknown> | null {
  const texto = leerArchivo(ruta);
  if (texto === null) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    return valor && typeof valor === 'object' ? (valor as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* Versión fijada de Sentinel en el área: quality-tools.json del propio manager.
 * [por que] Se resolvia como `<area>/workspace-manager/quality-tools.json`, que
 * incrustaba el nombre del proyecto y solo acertaba si el area era justo la
 * carpeta padre del repo. El fichero es del manager: se pide desde su raiz. */
export function leerPinArea(raizRepo: string): string | null {
  const json = leerJson(join(raizRepo, 'quality-tools.json'));
  const tools = json?.tools as { sentinel?: { version?: unknown } } | undefined;
  const v = tools?.sentinel?.version;
  return typeof v === 'string' ? v : null;
}

/* Runtime global instalado: %LOCALAPPDATA%\GlorySentinel\current.json. */
function leerRuntimeSentinel(entorno: Entorno): string | null {
  const local = entorno.localAppData ?? join(entorno.homedir, 'AppData', 'Local');
  const v = leerJson(join(local, 'GlorySentinel', 'current.json'))?.version;
  return typeof v === 'string' ? v : null;
}

function targetDirDe(ruta: string): string | null {
  const texto = leerArchivo(join(ruta, '.cargo', 'config.toml'));
  const m = texto?.match(/^\s*target-dir\s*=\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

function versionSentinelLock(ruta: string): string | null {
  const analyzers = leerSentinelLock(ruta)?.analyzers as { sentinel?: { version?: unknown } } | undefined;
  const v = analyzers?.sentinel?.version;
  return typeof v === 'string' ? v : null;
}

function estadoGuard(ruta: string, clave: string, plantilla: LecturaPlantilla): EstadoGuard {
  const politica = leerPolitica(ruta);
  if (politica.estado === 'ausente') return { estado: 'ausente' };
  if (politica.estado === 'invalida') return { estado: 'invalida', motivo: politica.motivo };
  /* [por que] Sin plantilla legible no hay nada contra qué comparar: faltan = []. */
  const faltanPlantilla =
    plantilla.estado === 'ok'
      ? diferenciasPlantilla(politica.listas, plantilla.plantilla.stackDeProyecto[clave] ?? [], plantilla.plantilla).faltan
      : [];
  return { estado: 'ok', modo: politica.modo, listas: politica.listas, faltanPlantilla };
}

/* Ramas no integradas en main, locales y remotas. `--no-merged=main` falla si no hay
 * main: entonces no hay base contra la que medir y no se listan ramas.
 * [por que] Asíncrona: con `git` síncrono cada repo bloqueaba el event loop (~210 ms en frío)
 * y las ramas de la consola, que van en paralelo, acababan en serie. */
async function ramasSueltas(ruta: string, puerto: PuertoGit = PUERTO_GIT): Promise<RamaSuelta[]> {
  const salida = await puerto.gitAsync(ruta, [
    'for-each-ref',
    '--no-merged=main',
    '--format=%(refname)%09%(committerdate:unix)',
    'refs/heads',
    'refs/remotes/origin',
  ]);
  if (salida === null) return [];
  const ramas: RamaSuelta[] = [];
  for (const linea of salida.split('\n')) {
    const [ref, unix] = linea.trim().split('\t');
    if (!ref || !unix || ref === 'refs/remotes/origin/HEAD') continue;
    ramas.push({
      nombre: ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, ''),
      remota: ref.startsWith('refs/remotes/'),
      ultimoCommitMs: Number(unix) * 1000,
    });
  }
  return ramas;
}

function planesActivos(ruta: string, declarados: string[]): PlanActivo[] {
  const dir = join(ruta, 'Agente', 'planes');
  let nombres: string[];
  try {
    nombres = readdirSync(dir);
  } catch {
    return [];
  }
  /* [por que] README.md es el índice de la carpeta, no un plan: no entra en la comprobación. */
  return nombres
    .filter((n) => n.endsWith('.md') && n !== 'README.md')
    .map((archivo) => ({
      archivo,
      modificadoMs: statSync(join(dir, archivo)).mtimeMs,
      abiertas: abiertasDelPlan(leerArchivo(join(dir, archivo)) ?? '', declarados, archivo),
    }));
}

/* Enlaces .md de roadmap.md que apuntan a ficheros inexistentes. */
function enlacesRotos(ruta: string, texto: string): string[] {
  const rotos = new Set<string>();
  for (const m of texto.matchAll(/\]\((?!https?:|#)([^)\s]+?\.md)\)/g)) {
    if (!existsSync(join(ruta, m[1]))) rotos.add(m[1]);
  }
  return [...rotos];
}

/* Rangos de Vite y TypeScript en frontend/package.json; null si el proyecto no tiene frontend. */
function toolchainFrontend(ruta: string): { vite: string | null; typescript: string | null } | null {
  const pkg = leerJson(join(ruta, 'frontend', 'package.json'));
  if (pkg === null) return null;
  const declarada = (nombre: string): string | null => {
    for (const seccion of [pkg.dependencies, pkg.devDependencies]) {
      const v = (seccion as Record<string, unknown> | undefined)?.[nombre];
      if (typeof v === 'string') return v;
    }
    return null;
  };
  return { vite: declarada('vite'), typescript: declarada('typescript') };
}

/* Datos de todos los proyectos a la vez: los target-dir compartidos solo se ven
 * cruzando proyectos. */
export async function recogerProyectos(
  proyectos: Proyecto[],
  ctx: { ahora: number; pinArea: string | null; plantilla: LecturaPlantilla; runtimeSentinel: string | null },
): Promise<DatosProyecto[]> {
  const targetDirPor = new Map(proyectos.map((p) => [p.clave, targetDirDe(p.ruta)] as const));
  const claves = new Map<string, string[]>();
  for (const [clave, td] of targetDirPor) {
    if (td) claves.set(td, [...(claves.get(td) ?? []), clave]);
  }
  /* [por que] Los repos se leen a la vez (git asíncrono): el coste se solapa en vez de sumarse. */
  return Promise.all(proyectos.map(async (p) => {
    const td = targetDirPor.get(p.clave) ?? null;
    const esRust = existsSync(join(p.ruta, 'Cargo.toml'));
    /* [por que] roadmap.md se lee una vez y alimenta el analisis del protocolo y los
     * enlaces rotos: antes lo leia cada funcion por su cuenta. */
    const roadmapTexto = leerArchivo(join(p.ruta, 'roadmap.md')) ?? '';
    const roadmap = analizarRoadmap(roadmapTexto);
    return {
      clave: p.clave,
      ahora: ctx.ahora,
      esElegible: p.gate?.puerta === 'sentinel',
      esRust,
      compilacionEnArbol: CARPETAS_COMPILACION.filter((c) => existsSync(join(p.ruta, c))),
      targetDir: td,
      targetDirCompartidoCon: td ? (claves.get(td) ?? []).filter((c) => c !== p.clave) : [],
      incrementalDesactivadoEn: FICHEROS_ENTORNO.filter((f) => RE_INCREMENTAL_0.test(leerArchivo(join(p.ruta, f)) ?? '')),
      tieneProfileDev: esRust && /^\s*\[profile\.dev\]/m.test(leerArchivo(join(p.ruta, 'Cargo.toml')) ?? ''),
      sentinelLock: versionSentinelLock(p.ruta),
      sentinelPin: ctx.pinArea,
      esRuntimeSentinel: p.clave === ctx.runtimeSentinel,
      guard: estadoGuard(p.ruta, p.clave, ctx.plantilla),
      ramas: await ramasSueltas(p.ruta),
      instruccionesProhibidas: DOCS_PROHIBIDOS.filter((f) => existsSync(join(p.ruta, f))),
      planesActivos: planesActivos(p.ruta, roadmap.planes),
      roadmap,
      enlacesRotos: enlacesRotos(p.ruta, roadmapTexto),
      toolchainFrontend: toolchainFrontend(p.ruta),
    };
  }));
}

function discoLibreGb(raizArea: string): number | null {
  try {
    /* [por que] La unidad se DERIVA de la raiz del area, no se escribe a mano:
     * el dato que se quiere medir es «cuanto espacio libre tiene el area», y
     * esa es su unidad. Un `C:/` fijo mentia en cualquier maquina donde el
     * area viva en otra letra (o en Linux, donde ni existe C:). */
    const s = statfsSync(parse(raizArea).root);
    return (Number(s.bavail) * Number(s.bsize)) / GB;
  } catch {
    return null;
  }
}

/* El mando declara sus subcomandos en el bloque AYUDA de dev.mjs.
 * [por que] Igual que leerPinArea: el mando es de este repo, asi que su script
 * se pide desde la raíz del repo y no como `<area>/workspace-manager/...`. */
function subcomandosArranque(entorno: Entorno): string[] {
  const bloque = leerArchivo(join(entorno.raizRepo, 'scripts', 'dev', 'dev.mjs'))?.match(
    /const AYUDA = `([\s\S]*?)`;/,
  );
  if (!bloque) return [];
  return [...bloque[1].matchAll(/^ {2}(\w+)/gm)].map((m) => m[1]);
}

export async function recogerArea(
  proyectos: Proyecto[],
  raizArea: string,
  pinArea: string | null,
  ahora: number,
  entorno: Entorno,
): Promise<DatosArea> {
  const carpetasGit = readdirSync(raizArea, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(raizArea, d.name, '.git')))
    .map((d) => d.name);
  /* registro.json: `proyectos` (array con id) y `noAplica` (objeto id → motivo).
   * [por que] La config privada vive en el repo (`RAIZ_REPO/config`), no en la
   * raíz del área: pasar `raizArea` resolvía a `<área>/config/registro.json`,
   * que no existe, así que `noAplica` salía siempre vacío y todo repo declarado
   * ahí (p. ej. freebuff) se reportaba como «sin registrar». */
  const registro = leerJson(entorno.rutaConfigPrivada('registro.json'));
  const idsProyectos = Array.isArray(registro?.proyectos)
    ? (registro.proyectos as { id?: unknown }[]).map((p) => p.id).filter((id): id is string => typeof id === 'string')
    : [];
  const noAplica = Object.keys((registro?.noAplica as Record<string, unknown> | undefined) ?? {});
  const agentsTexto = leerArchivo(join(raizArea, 'AGENTS.md'));
  let agentsBytes: number | null = null;
  try {
    agentsBytes = statSync(join(raizArea, 'AGENTS.md')).size;
  } catch {
    agentsBytes = null;
  }
  return {
    ahora,
    carpetasGit,
    registradas: [...new Set([...proyectos.map((p) => p.clave), ...idsProyectos, ...noAplica])],
    plataforma: entorno.plataforma,
    discoLibreGb: discoLibreGb(raizArea),
    rutaTemporales: entorno.raizTemporales,
    tmp: await medirTmp(entorno.raizTemporales, PRESUPUESTO_TMP_MS),
    /* [por que] Las variables de usuario entran por el entorno ya leídas, no por process.env aquí. */
    incrementalUsuario: entorno.cargoIncremental ?? null,
    sentinelPin: pinArea,
    sentinelRuntime: leerRuntimeSentinel(entorno),
    agentsBytes,
    titulosAgents: encabezados(agentsTexto),
    titulosClaudeMd: encabezados(leerArchivo(join(entorno.homedir, '.claude', 'CLAUDE.md'))),
    subcomandosArranque: subcomandosArranque(entorno),
    skillArranque: skillArranque(entorno),
    copiasSkill: copiasSkill(entorno),
  };
}
