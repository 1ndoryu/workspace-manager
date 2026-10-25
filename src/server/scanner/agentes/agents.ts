/* Resumen de AGENTS.md y skills globales.
 * [por que] El manager gestiona AGENTS.md (global + por proyecto) y las skills
 * de ~/.agents/skills; este modulo extrae reglas y skills sin depender de parseo
 * completo de markdown. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentesInfo, ResumenAgents, SkillGlobal } from '../../shared/types.js';

/* [por que] Quita comillas envolventes (simples o dobles) que YAML puede
 * colocar alrededor de un valor escalar de una linea. */
function limpiarEscalar(resto: string): string {
  const v = resto.trim();
  if (v === '') return '';
  const pri = v[0];
  const ult = v[v.length - 1];
  if ((pri === '"' && ult === '"') || (pri === "'" && ult === "'")) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/* [por que] El campo description puede ser una linea, un bloque "|" / ">"
 * (con o sin indicador |+ |-, >+ >-), o un valor vacio. Segun el tipo se
 * leen las lineas indentadas siguientes y se unen en un parrafo. */
function parsearDescripcion(texto: string): string {
  const lineas = texto.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^description:\s*(.*)$/);
    if (!m) continue;
    const resto = m[1].trim();
    /* Indicador de bloque: los contenidos van en lineas indentadas. */
    if (/^[|>][-+]?$/.test(resto)) {
      const parrafo: string[] = [];
      for (let j = i + 1; j < lineas.length; j++) {
        const linea = lineas[j];
        if (!/^[ \t]/.test(linea)) break;
        const contenido = linea.trim();
        if (!contenido || /^[-*]\s/.test(contenido)) continue;
        parrafo.push(contenido);
      }
      return parrafo.join(' ');
    }
    /* Valor compatto (una linea, opcionalmente entre comillas). */
    return limpiarEscalar(resto);
  }
  return '';
}

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
          descripcion = parsearDescripcion(readFileSync(skillMd, 'utf8'));
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
