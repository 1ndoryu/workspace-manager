/* Escaner del workspace: detecta proyectos (git / no-git / worktrees / submodulos)
 * en la raiz del area de trabajo, con recursividad controlada.
 * [por que] Un worktree tiene el .git como ARCHIVO (no carpeta) y hay carpetas que
 * solo agrupan: dentro puede haber un repo de verdad -> se baja un nivel. */
import { readdirSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { detectarGit, estadoGit } from './git.js';
import { estadoGate, diagnosticarGate } from './gate.js';
import { resumenRoadmap } from './roadmap.js';
import { resumenAgents, agentesGlobales } from './agents.js';
import { leerConfigArea } from '../configArea.js';
import { RAIZ_REPO } from '../../shared/rutas.js';
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

/** Escanea la raiz y devuelve el snapshot completo del workspace. */
export function escanearWorkspace(opts: OpcionesEscaneo): SnapshotWorkspace {
  const proyectos: Proyecto[] = [];
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
      proyectos.push(proyectoCompleto(opts.raiz, ruta, nombre, info.esWorktree ? 'worktree' : 'repo', info.padre, sinGate, varsenseOpcional));
    } else if (recursivas.has(nombre)) {
      /* bajar un nivel: dentro de una carpeta que solo agrupa puede haber repos */
      const internos = leerEntradas(ruta);
      for (const interno of internos) {
        const rutaInterna = join(ruta, interno);
        if (ignoradas.has(interno)) continue;
        const infoInterno = detectarGit(rutaInterna);
        if (infoInterno.esRepo) {
          proyectos.push(proyectoCompleto(opts.raiz, rutaInterna, interno, infoInterno.esWorktree ? 'worktree' : 'repo', infoInterno.padre, sinGate, varsenseOpcional));
        } else {
          proyectos.push({ id: interno, clave: claveDe(rutaInterna, opts.raiz), ruta: rutaInterna, esGit: false, tipo: 'carpeta', padre: nombre });
        }
      }
    } else {
      proyectos.push({ id: nombre, clave: claveDe(ruta, opts.raiz), ruta, esGit: false, tipo: 'carpeta' });
    }
  }

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
function proyectoCompleto(
  raiz: string,
  ruta: string,
  id: string,
  tipo: 'repo' | 'worktree',
  padre: string | null,
  sinGate: Set<string> = new Set(),
  varsenseOpcional: Set<string> = new Set(),
): Proyecto {
  const clave = claveDe(ruta, raiz);
  const gate = estadoGate(ruta);
  /* [por que] Excepcion explicita del gate (plan 308A-1): glory-sentinel (el
   * propio repo del runtime) se exime de llevar gate. Sigue VISIBLE en
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
    git: estadoGit(ruta) ?? undefined,
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
