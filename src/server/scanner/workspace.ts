/* Escaner del workspace: detecta proyectos (git / no-git / worktrees / submodulos)
 * en la raiz del area de trabajo, con recursividad controlada.
 * [por que] Un worktree tiene el .git como ARCHIVO (no carpeta) y hay carpetas que
 * solo agrupan: dentro puede haber un repo de verdad -> se baja un nivel. */
import { existsSync, readdirSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { detectarGit } from './gitDeteccion.js';
import { estadoGitAsync } from './git.js';
import type { PuertoGit } from './puertoGit.js';
import { estadoGate, diagnosticarGate } from './gate.js';
import { resumenRoadmap } from './roadmap/roadmap.js';
import { resumenAgents, agentesGlobales } from './agents.js';
import { leerConfigArea } from '../configArea.js';
import { anotarRegistro, leerRegistroOpcional } from '../registro.js';
import { NOMBRE_QUALITY_TOOLS, RAIZ_REPO } from '../plataforma/rutas.js';
import type { EstadoGate, Proyecto, SnapshotWorkspace } from '../../shared/types.js';

/* Exclusiones a mano, por encima de la regla de señal (308A-8). Son pocas y cada una tiene motivo:
 * - `.git`: es el gitdir de un repo, nunca un proyecto en sí (detectarGit lo vería como repo).
 * - `NOMBRE_QUALITY_TOOLS`: herramienta del gate del área, no un proyecto aunque lleve manifiesto.
 * [por que] Lo demás (node_modules, dist, temp…) ya no está en esta lista: sin señal no es
 * proyecto, y si tiene señal y hay que ocultarlo, va a `carpetasIgnoradas` o `ignorados` de la config. */
const EXCLUIDAS_A_MANO = new Set(['.git', NOMBRE_QUALITY_TOOLS]);

export interface OpcionesEscaneo {
  raiz: string;
  carpetaSkills: string;
  /* Git inyectado: el escáner nunca lanza git por su cuenta (19AA-13). */
  puerto: PuertoGit;
}

/* Clave unica de un proyecto: ruta relativa al area, separador '/'. */
export function claveDe(ruta: string, raiz: string): string {
  const rel = relative(normalize(raiz), normalize(ruta));
  return rel.split(sep).join('/');
}

/* Recalcula el resumen (conteos) de un snapshot dado su array de proyectos.
 * [por que] Al mutar el snapshot (ignorar/quitar) se recalcula el resumen sin
 * re-escandear; el resumen es un derivado barato de proyectos. */
export function resumenDe(proyectos: Proyecto[]): SnapshotWorkspace['resumen'] {
  return {
    total: proyectos.length,
    repos: proyectos.filter((p) => p.tipo === 'repo').length,
    worktrees: proyectos.filter((p) => p.tipo === 'worktree').length,
    carpetas: proyectos.filter((p) => p.tipo === 'carpeta').length,
    dirty: proyectos.filter((p) => p.git?.dirty).length,
    conGate: proyectos.filter((p) => p.gate?.declarado).length,
    pendientesRoadmap: proyectos.reduce((acc, p) => acc + (p.roadmap?.pendientes ?? 0), 0),
  };
}

/* Repos a leer con git. Se recogen primero (sin git) y luego se leen en paralelo. */
interface RepoPendiente {
  ruta: string;
  id: string;
  tipo: 'repo' | 'worktree';
  padre: string | null;
}

/* [por que] Cuantos git corren a la vez al escanear. El coste es espera de E/S
 * (Windows + OneDrive, ~230 ms por `status`), no CPU: unos pocos en paralelo
 * solapan la espera sin saturar el disco. Medido el 2026-10-19 (21 proyectos, portátil,
 * mediana de 3): 1 → 5,1 s; 4 → 2,2 s; 6 → 2,7 s. Por eso queda en 4. Se puede
 * cambiar con WS_REPOS_PARALELO para volver a medir; un valor no válido cae a 4. */
const REPOS_EN_PARALELO = Math.max(1, Number(process.env.WS_REPOS_PARALELO) || 4);

/* Ejecuta `fn` sobre cada elemento con como mucho `limite` promesas a la vez. Mantiene el orden. */
async function mapLimitado<T, R>(items: T[], limite: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let siguiente = 0;
  const trabajador = async (): Promise<void> => {
    while (siguiente < items.length) {
      const i = siguiente++;
      salida[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return salida;
}

type InfoGit = ReturnType<typeof detectarGit>;

function repoDe(ruta: string, id: string, info: InfoGit): RepoPendiente {
  return { ruta, id, tipo: info.esWorktree ? 'worktree' : 'repo', padre: info.padre };
}

/* Señales de que una carpeta sin git es un proyecto nuestro: su manifiesto de stack o su roadmap.
 * [por que] Antes toda carpeta no ignorada era proyecto: scripts/, data/ o respaldos/ salían en el
 * tablero como si lo fueran. La regla se invierte (308A-8): sin git, cuenta solo lo que trae un proyecto. */
const SENALES_PROYECTO = ['roadmap.md', 'Agente', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod'];

export function esProyectoSinGit(ruta: string): boolean {
  return SENALES_PROYECTO.some((s) => existsSync(join(ruta, s)));
}

/* Separa lo que hay en la raíz en repos (a leer con git) y carpetas de proyecto sin git.
 * [por que] Es el único paso que recorre el disco sin git: aislado, se prueba con un
 * directorio temporal sin repos reales. Las de `recursivas` se bajan un nivel. */
export function descubrir(raiz: string, ignoradas: Set<string>, recursivas: Set<string>): Descubierto {
  const carpetas: Proyecto[] = [];
  const repos: RepoPendiente[] = [];
  for (const nombre of leerEntradas(raiz)) {
    if (ignoradas.has(nombre)) continue;
    const ruta = join(raiz, nombre);
    const info = detectarGit(ruta);
    if (info.esRepo) {
      repos.push(repoDe(ruta, nombre, info));
    } else if (recursivas.has(nombre)) {
      /* bajar un nivel: dentro de una carpeta que solo agrupa puede haber repos */
      for (const interno of leerEntradas(ruta)) {
        if (ignoradas.has(interno)) continue;
        const rutaInterna = join(ruta, interno);
        const infoInterno = detectarGit(rutaInterna);
        if (infoInterno.esRepo) {
          repos.push(repoDe(rutaInterna, interno, infoInterno));
        } else if (esProyectoSinGit(rutaInterna)) {
          carpetas.push({ id: interno, clave: claveDe(rutaInterna, raiz), ruta: rutaInterna, esGit: false, tipo: 'carpeta', padre: nombre });
        }
      }
    } else if (esProyectoSinGit(ruta)) {
      carpetas.push({ id: nombre, clave: claveDe(ruta, raiz), ruta, esGit: false, tipo: 'carpeta' });
    }
  }
  return { carpetas, repos };
}

export interface Descubierto {
  carpetas: Proyecto[];
  repos: RepoPendiente[];
}

/** Escanea la raiz y devuelve el snapshot completo del workspace. */
export async function escanearWorkspace(opts: OpcionesEscaneo): Promise<SnapshotWorkspace> {
  const config = leerConfigArea(opts.raiz);
  const sinGate = new Set(config.sinGate ?? []);
  const varsenseOpcional = new Set(config.varsenseOpcional ?? []);
  const ignoradas = new Set([...EXCLUIDAS_A_MANO, ...(config.carpetasIgnoradas ?? [])]);
  const recursivas = new Set(config.carpetasRecursivas ?? []);

  const { carpetas, repos } = descubrir(opts.raiz, ignoradas, recursivas);
  /* El orden de llegada no importa: la lista se ordena por id más abajo. */
  const deRepos = await mapLimitado(repos, REPOS_EN_PARALELO, (r) =>
    proyectoCompleto(opts.raiz, r.ruta, r.id, r.tipo, r.padre, sinGate, varsenseOpcional, opts.puerto));
  const proyectos: Proyecto[] = [...carpetas, ...deRepos];

  /* Clave en los proyectos git y filtro de ignorados. [por que] La config
   * persistente define que proyectos se ignoran (p. ej. 3D/01); se quitan del
   * snapshot para que no aparezcan en mapa/lista/consola. */
  const ignoradoSet = new Set(config.ignorados);
  const visibles: Proyecto[] = proyectos
    .map((p) => ({ ...p, clave: claveDe(p.ruta, opts.raiz) }))
    .filter((p) => !ignoradoSet.has(p.clave));

  visibles.sort((a, b) => a.id.localeCompare(b.id));
  /* Vinculos del registro (ejecucion y Coolify) antes del resumen, que los usa. */
  const conRegistro = anotarRegistro(visibles, leerRegistroOpcional());

  const agentes = agentesGlobales(opts.raiz, opts.carpetaSkills);

  return {
    escaneadoEn: new Date().toISOString(),
    raiz: opts.raiz,
    proyectos: conRegistro,
    agentes,
    config,
    resumen: resumenDe(conRegistro),
  };
}

/** Construye un proyecto completo con git + gate + roadmap + agents. */
async function proyectoCompleto(
  raiz: string,
  ruta: string,
  id: string,
  tipo: 'repo' | 'worktree',
  padre: string | null,
  sinGate: Set<string>,
  varsenseOpcional: Set<string>,
  puerto: PuertoGit,
): Promise<Proyecto> {
  const clave = claveDe(ruta, raiz);
  const gate = estadoGate(ruta);
  /* [por que] Excepcion explicita del gate (plan 308A-1): el papel `sentinel`
   * (el propio repo del runtime) se exime de llevar gate. Sigue VISIBLE en
   * mapa/lista (a diferencia de ignorados) y no genera problema "sin gate"
   * en la consola: la puerta se fuerza a 'none' y gateDisponible a false. */
  const gateReal: EstadoGate | undefined = sinGate.has(clave)
    ? { ...gate, declarado: false, puerta: 'none', gateDisponible: false, exentoGate: true }
    /* [por que] Exencion fina de varsense (v4): el proyecto conserva su gate
     * sentinel declarado y solo se marca varsense como opcional para que la
     * consola no genere "varsense ausente". Solo aplica con gate declarado;
     * sin gate sigue el problema "sin sentinel/varsense declarado". */
    : gate?.declarado && varsenseOpcional.has(clave)
      ? { ...gate, varsenseOpcional: true }
      : gate;
  return {
    id,
    clave,
    ruta,
    esGit: true,
    tipo,
    padre: padre ?? undefined,
    /* [por que] Quien es el tablero se decide por RUTA, no por nombre: el id de
     * la carpeta es cosa de nuestra config (puede llamarse de otra forma, o ser
     * la réplica de la 89). Lo consume la clasificación compartida, que no
     * puede mirar rutas por sí misma (no tiene Node). */
    esMando: normalize(ruta).toLowerCase() === normalize(RAIZ_REPO).toLowerCase(),
    git: await estadoGitAsync(ruta, puerto),
    gate: gateReal,
    gateProblemas: diagnosticarGate(ruta),
    roadmap: resumenRoadmap(ruta),
    agents: resumenAgents(ruta, ''),
  };
}

/** Vuelve a leer solo el estado git de los repos de un snapshot ya escaneado.
 * [por que] El snapshot cacheado se sirve sin re-escanear, y el estado git (sucio,
 * ahead) se quedaba congelado en el momento del escaneo: el tablero daba «16 sin
 * commitear» con el repo ya limpio. Releer solo git es mucho más barato que el
 * escaneo completo (gate, roadmap, agentes), así que basta con esto. */
export async function refrescarGit(snapshot: SnapshotWorkspace, puerto: PuertoGit): Promise<SnapshotWorkspace> {
  const proyectos = await mapLimitado(snapshot.proyectos, REPOS_EN_PARALELO, async (p) =>
    p.esGit ? { ...p, git: await estadoGitAsync(p.ruta, puerto) } : p);
  return { ...snapshot, proyectos, resumen: resumenDe(proyectos), gitEn: new Date().toISOString() };
}

function leerEntradas(ruta: string): string[] {
  try {
    return readdirSync(ruta, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}
