/* Escaner del workspace: detecta proyectos (git / no-git / worktrees / submodulos)
 * en la raiz del area de trabajo, con recursividad controlada.
 * [por que] RESTAURANTE es un worktree cuyo .git es un ARCHIVO (no carpeta);
 * TRABAJOS CLIENTES/ contiene ONG AGAPE que si es repo -> se baja un nivel. */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { detectarGit, estadoGit } from './git.js';
import { estadoGate } from './gate.js';
import { resumenRoadmap } from './roadmap.js';
import { resumenAgents, agentesGlobales } from './agents.js';
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

/** Escanea la raiz y devuelve el snapshot completo del workspace. */
export function escanearWorkspace(opts: OpcionesEscaneo): SnapshotWorkspace {
  const proyectos: Proyecto[] = [];
  const entradas = leerEntradas(opts.raiz);

  for (const nombre of entradas) {
    const ruta = join(opts.raiz, nombre);
    if (IGNORADAS.has(nombre)) continue;
    const info = detectarGit(ruta);

    if (info.esRepo) {
      proyectos.push(proyectoCompleto(ruta, nombre, info.esWorktree ? 'worktree' : 'repo', info.padre));
    } else if (RECURSIVAS.has(nombre)) {
      /* bajar un nivel: ONG AGAPE dentro de TRABAJOS CLIENTES */
      const internos = leerEntradas(ruta);
      for (const interno of internos) {
        const rutaInterna = join(ruta, interno);
        if (IGNORADAS.has(interno)) continue;
        const infoInterno = detectarGit(rutaInterna);
        if (infoInterno.esRepo) {
          proyectos.push(proyectoCompleto(rutaInterna, interno, infoInterno.esWorktree ? 'worktree' : 'repo', infoInterno.padre));
        } else {
          proyectos.push({ id: interno, ruta: rutaInterna, esGit: false, tipo: 'carpeta', padre: nombre });
        }
      }
    } else {
      proyectos.push({ id: nombre, ruta, esGit: false, tipo: 'carpeta' });
    }
  }

  proyectos.sort((a, b) => a.id.localeCompare(b.id));

  const agentes = agentesGlobales(opts.raiz, opts.carpetaSkills);

  return {
    escaneadoEn: new Date().toISOString(),
    raiz: opts.raiz,
    proyectos,
    agentes,
    resumen: {
      total: proyectos.length,
      repos: proyectos.filter(p => p.tipo === 'repo').length,
      worktrees: proyectos.filter(p => p.tipo === 'worktree').length,
      carpetas: proyectos.filter(p => p.tipo === 'carpeta').length,
      dirty: proyectos.filter(p => p.git?.dirty).length,
      conGate: proyectos.filter(p => p.gate?.declarado).length,
      pendientesRoadmap: proyectos.reduce((acc, p) => acc + (p.roadmap?.pendientes ?? 0), 0),
    },
  };
}

/** Construye un proyecto completo con git + gate + roadmap + agents. */
function proyectoCompleto(
  ruta: string,
  id: string,
  tipo: 'repo' | 'worktree',
  padre: string | null,
): Proyecto {
  return {
    id,
    ruta,
    esGit: true,
    tipo,
    padre: padre ?? undefined,
    git: estadoGit(ruta) ?? undefined,
    gate: estadoGate(ruta),
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
