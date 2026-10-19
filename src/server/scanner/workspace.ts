/* Escaner del workspace: detecta proyectos (git / no-git / worktrees / submodulos)
 * en la raiz del area de trabajo, con recursividad controlada.
 * [por que] Un worktree tiene el .git como ARCHIVO (no carpeta) y hay carpetas que
 * solo agrupan: dentro puede haber un repo de verdad -> se baja un nivel. */
import { readdirSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { detectarGit, estadoGitAsync } from './git.js';
import { estadoGate, diagnosticarGate } from './gate.js';
import { resumenRoadmap } from './roadmap.js';
import { resumenAgents, agentesGlobales } from './agents.js';
import { leerConfigArea } from '../configArea.js';
import { RAIZ_REPO } from '../plataforma/rutas.js';
import type { EstadoGate, Proyecto, SnapshotWorkspace } from '../../shared/types.js';

/* Carpetas que NUNCA se tratan como proyecto, en cualquier area: no son datos
 * nuestros, son de la forma en que un repo se construye y se ejecuta.
 * [por que] Las de una area concreta (carpetas de clientes, agrupaciones
 * propias) NO van aqui: las declara `carpetasIgnoradas` en la config. Antes
 * estaba incrustada una de ellas y el escaner solo servia para una maquina. */
const IGNORADAS = new Set([
  '.git',
  'node_modules',
  'dist',
  'temp',
  'uploads',
  '.sentinel',
  '.quality-tools',
  '.archivado',
  'Agente',
  'DOCS',
  'PLUGINS',
]);

export interface OpcionesEscaneo {
  raiz: string;
  carpetaSkills: string;
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

/** Escanea la raiz y devuelve el snapshot completo del workspace. */
export async function escanearWorkspace(opts: OpcionesEscaneo): Promise<SnapshotWorkspace> {
  const carpetas: Proyecto[] = [];
  const repos: RepoPendiente[] = [];
  const entradas = leerEntradas(opts.raiz);

  const config = leerConfigArea(opts.raiz);
  const sinGate = new Set(config.sinGate ?? []);
  const varsenseOpcional = new Set(config.varsenseOpcional ?? []);
  const ignoradas = new Set([...IGNORADAS, ...(config.carpetasIgnoradas ?? [])]);
  const recursivas = new Set(config.carpetasRecursivas ?? []);

  for (const nombre of entradas) {
    const ruta = join(opts.raiz, nombre);
    if (ignoradas.has(nombre)) continue;
    const info = detectarGit(ruta);

    if (info.esRepo) {
      repos.push({ ruta, id: nombre, tipo: info.esWorktree ? 'worktree' : 'repo', padre: info.padre });
    } else if (recursivas.has(nombre)) {
      /* bajar un nivel: dentro de una carpeta que solo agrupa puede haber repos */
      const internos = leerEntradas(ruta);
      for (const interno of internos) {
        const rutaInterna = join(ruta, interno);
        if (ignoradas.has(interno)) continue;
        const infoInterno = detectarGit(rutaInterna);
        if (infoInterno.esRepo) {
          repos.push({ ruta: rutaInterna, id: interno, tipo: infoInterno.esWorktree ? 'worktree' : 'repo', padre: infoInterno.padre });
        } else {
          carpetas.push({ id: interno, clave: claveDe(rutaInterna, opts.raiz), ruta: rutaInterna, esGit: false, tipo: 'carpeta', padre: nombre });
        }
      }
    } else {
      carpetas.push({ id: nombre, clave: claveDe(ruta, opts.raiz), ruta, esGit: false, tipo: 'carpeta' });
    }
  }

  /* El orden de llegada no importa: la lista se ordena por id más abajo. */
  const deRepos = await mapLimitado(repos, REPOS_EN_PARALELO, (r) =>
    proyectoCompleto(opts.raiz, r.ruta, r.id, r.tipo, r.padre, sinGate, varsenseOpcional));
  const proyectos: Proyecto[] = [...carpetas, ...deRepos];

  /* Clave en los proyectos git y filtro de ignorados. [por que] La config
   * persistente define que proyectos se ignoran (p. ej. 3D/01); se quitan del
   * snapshot para que no aparezcan en mapa/lista/consola. */
  const ignoradoSet = new Set(config.ignorados);
  const visibles: Proyecto[] = proyectos
    .map((p) => ({ ...p, clave: claveDe(p.ruta, opts.raiz) }))
    .filter((p) => !ignoradoSet.has(p.clave));

  visibles.sort((a, b) => a.id.localeCompare(b.id));

  const agentes = agentesGlobales(opts.raiz, opts.carpetaSkills);

  return {
    escaneadoEn: new Date().toISOString(),
    raiz: opts.raiz,
    proyectos: visibles,
    agentes,
    config,
    resumen: resumenDe(visibles),
  };
}

/** Construye un proyecto completo con git + gate + roadmap + agents. */
async function proyectoCompleto(
  raiz: string,
  ruta: string,
  id: string,
  tipo: 'repo' | 'worktree',
  padre: string | null,
  sinGate: Set<string> = new Set(),
  varsenseOpcional: Set<string> = new Set(),
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
    git: await estadoGitAsync(ruta),
    gate: gateReal,
    gateProblemas: diagnosticarGate(ruta),
    roadmap: resumenRoadmap(ruta),
    agents: resumenAgents(ruta, ''),
  };
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
