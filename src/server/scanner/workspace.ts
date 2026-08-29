/* Escaner del workspace: detecta proyectos (git / no-git / worktrees / submodulos)
 * en la raiz del area de trabajo, con recursividad controlada.
 * [por que] RESTAURANTE es un worktree cuyo .git es un ARCHIVO (no carpeta);
 * TRABAJOS CLIENTES/ contiene ONG AGAPE que si es repo -> se baja un nivel. */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, normalize, relative, sep } from 'node:path';
import { detectarGit, estadoGit } from './git.js';
import { estadoGate, diagnosticarGate } from './gate.js';
import { resumenRoadmap } from './roadmap.js';
import { resumenAgents, agentesGlobales } from './agents.js';
import { leerConfigArea } from '../configArea.js';
import type { Proyecto, SnapshotWorkspace } from '../../shared/types.js';

/* Carpetas que nunca se tratan como proyecto */
const IGNORADAS = new Set([
  '.archivado',
  '.freebuff',
  'node_modules',
  '.git',
  '.sentinel',
  '.quality-tools',
  'dist',
  'temp',
  'uploads',
  'Agente',
  'DOCS',
  'PLUGINS',
]);

/* Carpetas donde se baja un nivel para encontrar proyectos reales */
const RECURSIVAS = new Set(['TRABAJOS CLIENTES', '3D']);

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

  for (const nombre of entradas) {
    const ruta = join(opts.raiz, nombre);
    if (IGNORADAS.has(nombre)) continue;
    const info = detectarGit(ruta);

    if (info.esRepo) {
      proyectos.push(proyectoCompleto(opts.raiz, ruta, nombre, info.esWorktree ? 'worktree' : 'repo', info.padre));
    } else if (RECURSIVAS.has(nombre)) {
      /* bajar un nivel: ONG AGAPE dentro de TRABAJOS CLIENTES */
      const internos = leerEntradas(ruta);
      for (const interno of internos) {
        const rutaInterna = join(ruta, interno);
        if (IGNORADAS.has(interno)) continue;
        const infoInterno = detectarGit(rutaInterna);
        if (infoInterno.esRepo) {
          proyectos.push(proyectoCompleto(opts.raiz, rutaInterna, interno, infoInterno.esWorktree ? 'worktree' : 'repo', infoInterno.padre));
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
  const config = leerConfigArea(opts.raiz);
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
): Proyecto {
  return {
    id,
    clave: claveDe(ruta, raiz),
    ruta,
    esGit: true,
    tipo,
    padre: padre ?? undefined,
    git: estadoGit(ruta) ?? undefined,
    gate: estadoGate(ruta),
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
