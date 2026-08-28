/* Resumen de AGENTS.md y skills globales.
 * [por que] El manager gestiona AGENTS.md (global + por proyecto) y las skills
 * de ~/.agents/skills; este modulo extrae reglas y skills sin depender de parseo
 * completo de markdown. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentesInfo, ResumenAgents, SkillGlobal } from '../../shared/types.js';

const RE_REGLA = /<rule\b[^>]*\bname="([^"]+)"/g;

/** Extrae reglas declaradas de un AGENTS.md. */
function extraerReglas(texto: string): string[] {
  const reglas: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE_REGLA.exec(texto)) !== null) {
    reglas.push(m[1]);
  }
  return reglas;
}

/** Resumen de AGENTS.md de un proyecto (ruta con AGENTS.md). */
export function resumenAgents(ruta: string, _carpetaSkills: string): ResumenAgents {
  const archivo = join(ruta, 'AGENTS.md');
  if (!existsSync(archivo)) {
    return { tieneAgentsMd: false, reglas: [], skills: [] };
  }
  try {
    const texto = readFileSync(archivo, 'utf8');
    const reglas = extraerReglas(texto);
    const skills = (texto.match(/`([a-z-]+)`/g) ?? [])
      .map(s => s.replace(/`/g, ''))
      .filter(s => /skill|sentinel|varsense|gate/i.test(s));
    return { tieneAgentsMd: true, reglas, skills };
  } catch {
    return { tieneAgentsMd: false, reglas: [], skills: [] };
  }
}

/** Info global: AGENTS.md de la raiz + skills globales de ~/.agents/skills. */
export function agentesGlobales(raiz: string, carpetaSkills: string): AgentesInfo {
  const agentsMd = join(raiz, 'AGENTS.md');
  let reglas: string[] = [];
  let tieneAgentsMd = false;
  if (existsSync(agentsMd)) {
    tieneAgentsMd = true;
    reglas = extraerReglas(readFileSync(agentsMd, 'utf8'));
  }

  const skills: SkillGlobal[] = [];
  try {
    const entradas = readdirSync(carpetaSkills, { withFileTypes: true });
    for (const entrada of entradas) {
      if (!entrada.isDirectory()) continue;
      const skillMd = join(carpetaSkills, entrada.name, 'SKILL.md');
      let descripcion = '';
      if (existsSync(skillMd)) {
        try {
          const texto = readFileSync(skillMd, 'utf8');
          const m = texto.match(/^description:\s*(.+)$/m);
          if (m) descripcion = m[1].trim();
        } catch {
          /* skill sin descripcion */
        }
      }
      skills.push({ nombre: entrada.name, descripcion, ruta: skillMd });
    }
  } catch {
    /* carpeta de skills no existe -> lista vacia */
  }
  skills.sort((a, b) => a.nombre.localeCompare(b.nombre));

  return {
    global: { tieneAgentsMd, ruta: tieneAgentsMd ? agentsMd : null, reglas },
    skills,
  };
}
