/* Lectura de datos para la salud (10AA-2 F8). Único punto con I/O: disco, Git y
 * variables. Las comprobaciones (comprobacionesProyecto/Area) solo juzgan lo que aquí
 * se lee.
 * [por que] La medición de C:\tmp es asíncrona y con presupuesto de tiempo: recorrer
 * targets de cargo de varios GB de forma síncrona bloquearía el servidor. */
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, parse } from 'node:path';
import { CARPETA_SKILLS, RAIZ_AREA, RAIZ_REPO, rutaConfigPrivada } from '../../shared/rutas.js';
import type { Proyecto } from '../../shared/types.js';
import { leerArchivo } from '../http.js';
import { leerSentinelLock } from '../scanner/gate.js';
import { git } from '../scanner/git.js';
import { diferenciasPlantilla, leerPolitica } from '../guardian/configuracion/politica.js';
import type { LecturaPlantilla } from '../guardian/configuracion/plantilla.js';
import type { DatosArea, DatosProyecto, EstadoGuard, PlanActivo, RamaSuelta } from './tipos.js';
import { raizTemporales } from '../plataforma/temporales.js';

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
export function leerPinArea(): string | null {
  const json = leerJson(join(RAIZ_REPO, 'quality-tools.json'));
  const tools = json?.tools as { sentinel?: { version?: unknown } } | undefined;
  const v = tools?.sentinel?.version;
  return typeof v === 'string' ? v : null;
}

/* Runtime global instalado: %LOCALAPPDATA%\GlorySentinel\current.json. */
function leerRuntimeSentinel(): string | null {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
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
 * main: entonces no hay base contra la que medir y no se listan ramas. */
function ramasSueltas(ruta: string): RamaSuelta[] {
  const salida = git(ruta, [
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

function planesActivos(ruta: string): PlanActivo[] {
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
      abiertas: contarCasillasAbiertas(leerArchivo(join(dir, archivo)) ?? ''),
    }));
}

/* Casillas de tarea sin marcar (`- [ ]`, `* [ ]`) en un plan. */
function contarCasillasAbiertas(texto: string): number {
  return texto.match(/^\s*[-*]\s\[ \]/gm)?.length ?? 0;
}

/* Enlaces .md de roadmap.md que apuntan a ficheros inexistentes. */
function enlacesRotos(ruta: string): string[] {
  const texto = leerArchivo(join(ruta, 'roadmap.md'));
  if (texto === null) return [];
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
export function recogerProyectos(
  proyectos: Proyecto[],
  ctx: { ahora: number; pinArea: string | null; plantilla: LecturaPlantilla },
): DatosProyecto[] {
  const targetDirPor = new Map(proyectos.map((p) => [p.clave, targetDirDe(p.ruta)] as const));
  const claves = new Map<string, string[]>();
  for (const [clave, td] of targetDirPor) {
    if (td) claves.set(td, [...(claves.get(td) ?? []), clave]);
  }
  return proyectos.map((p) => {
    const td = targetDirPor.get(p.clave) ?? null;
    const esRust = existsSync(join(p.ruta, 'Cargo.toml'));
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
      guard: estadoGuard(p.ruta, p.clave, ctx.plantilla),
      ramas: ramasSueltas(p.ruta),
      instruccionesProhibidas: DOCS_PROHIBIDOS.filter((f) => existsSync(join(p.ruta, f))),
      planesActivos: planesActivos(p.ruta),
      enlacesRotos: enlacesRotos(p.ruta),
      toolchainFrontend: toolchainFrontend(p.ruta),
    };
  });
}

function encabezados(texto: string | null): string[] {
  if (texto === null) return [];
  return texto
    .split('\n')
    .map((l) => l.match(/^#{1,2}\s+(.+?)\s*$/)?.[1])
    .filter((t): t is string => t !== undefined);
}

function discoLibreGb(): number | null {
  try {
    /* [por que] La unidad se DERIVA de la raiz del area, no se escribe a mano:
     * el dato que se quiere medir es «cuanto espacio libre tiene el area», y
     * esa es su unidad. Un `C:/` fijo mentia en cualquier maquina donde el
     * area viva en otra letra (o en Linux, donde ni existe C:). */
    const s = statfsSync(parse(RAIZ_AREA).root);
    return (Number(s.bavail) * Number(s.bsize)) / GB;
  } catch {
    return null;
  }
}

/* Suma de C:\tmp con presupuesto de tiempo. Asíncrona para no bloquear el servidor.
 * [por que] Si no existe, null (la comprobación se omite); si se corta, parcial. */
async function medirTmp(raiz: string, presupuestoMs: number): Promise<{ bytes: number; parcial: boolean } | null> {
  try {
    await stat(raiz);
  } catch {
    return null;
  }
  const fin = Date.now() + presupuestoMs;
  let bytes = 0;
  let parcial = false;
  const pendientes = [raiz];
  while (pendientes.length > 0) {
    if (Date.now() > fin) {
      parcial = true;
      break;
    }
    const dir = pendientes.pop() as string;
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) pendientes.push(ruta);
      else if (e.isFile()) {
        try {
          bytes += (await stat(ruta)).size;
        } catch {
          /* fichero desaparecido durante el recorrido: no cuenta */
        }
      }
    }
  }
  return { bytes, parcial };
}

/* El mando declara sus subcomandos en el bloque AYUDA de dev.mjs.
 * [por que] Igual que leerPinArea: el mando es de este repo, asi que su script
 * se pide desde RAIZ_REPO y no como `<area>/workspace-manager/...`. */
function subcomandosArranque(): string[] {
  const bloque = leerArchivo(join(RAIZ_REPO, 'scripts', 'dev', 'dev.mjs'))?.match(
    /const AYUDA = `([\s\S]*?)`;/,
  );
  if (!bloque) return [];
  return [...bloque[1].matchAll(/^ {2}(\w+)/gm)].map((m) => m[1]);
}

/* leerArchivo devuelve null si no existe; '' (vacío) también cuenta como ausente.
 * [por que] La carpeta sale de CARPETA_SKILLS (su unico dueno, con WS_SKILLS_ROOT)
 * y el nombre de la skill se deriva del del repo: antes se escribia a mano
 * `~/.agents/skills/workspace-manager/SKILL.md`, que en un clon con otro nombre
 * de carpeta no encontraba nada. */
function skillArranque(): string | null {
  return leerArchivo(join(CARPETA_SKILLS, basename(RAIZ_REPO), 'SKILL.md')) || null;
}

/* AGENTS §10 pide que las copias en ~/.config/opencode/skills coincidan con
 * ~/.agents/skills: solo se comparan las skills que existen en el origen. */
function copiasSkill(): { nombre: string; coincide: boolean }[] {
  const origen = join(homedir(), '.agents', 'skills');
  const copias = join(homedir(), '.config', 'opencode', 'skills');
  let nombres: string[];
  try {
    nombres = readdirSync(copias, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  return nombres
    .filter((nombre) => existsSync(join(origen, nombre, 'SKILL.md')))
    .map((nombre) => ({
      nombre,
      coincide:
        leerArchivo(join(origen, nombre, 'SKILL.md')) === leerArchivo(join(copias, nombre, 'SKILL.md')),
    }));
}

export async function recogerArea(
  proyectos: Proyecto[],
  raizArea: string,
  pinArea: string | null,
  ahora: number,
): Promise<DatosArea> {
  const carpetasGit = readdirSync(raizArea, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(raizArea, d.name, '.git')))
    .map((d) => d.name);
  /* registro.json: `proyectos` (array con id) y `noAplica` (objeto id → motivo).
   * [por que] La config privada vive en el repo (`RAIZ_REPO/config`), no en la
   * raíz del área: pasar `raizArea` resolvía a `<área>/config/registro.json`,
   * que no existe, así que `noAplica` salía siempre vacío y todo repo declarado
   * ahí (p. ej. freebuff) se reportaba como «sin registrar». */
  const registro = leerJson(rutaConfigPrivada('registro.json'));
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
    discoLibreGb: discoLibreGb(),
    tmp: await medirTmp(raizTemporales(), PRESUPUESTO_TMP_MS),
    /* [por que] process.env hereda las variables de usuario al arrancar el servidor. */
    incrementalUsuario: process.env.CARGO_INCREMENTAL ?? null,
    sentinelPin: pinArea,
    sentinelRuntime: leerRuntimeSentinel(),
    agentsBytes,
    titulosAgents: encabezados(agentsTexto),
    titulosClaudeMd: encabezados(leerArchivo(join(homedir(), '.claude', 'CLAUDE.md'))),
    subcomandosArranque: subcomandosArranque(),
    skillArranque: skillArranque(),
    copiasSkill: copiasSkill(),
  };
}
