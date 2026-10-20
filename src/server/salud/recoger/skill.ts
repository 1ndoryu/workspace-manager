/* Lectura de las skills del mando Arranque y de sus copias en opencode. Es E/S de disco.
 * [por que] Separada de recoger.ts (19AA-13). */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { leerArchivo } from '../../http.js';
import { CARPETA_SKILLS_OPENCODE } from '../../plataforma/rutas.js';
import type { Entorno } from '../entorno.js';

/* leerArchivo devuelve null si no existe; '' (vacío) también cuenta como ausente.
 * [por que] La carpeta sale de CARPETA_SKILLS (su unico dueno, con WS_SKILLS_ROOT)
 * y el nombre de la skill se deriva del del repo: antes se escribia a mano
 * `~/.agents/skills/workspace-manager/SKILL.md`, que en un clon con otro nombre
 * de carpeta no encontraba nada. */
export function skillArranque(entorno: Entorno): string | null {
  return leerArchivo(join(entorno.carpetaSkills, basename(entorno.raizRepo), 'SKILL.md')) || null;
}

/* AGENTS §10 pide que las copias en ~/.config/opencode/skills coincidan con
 * la carpeta de skills (~/.agents/skills por defecto): solo se comparan las
 * skills que existen en el origen.
 * [por que] El origen sale de carpetaSkills (WS_SKILLS_ROOT lo cambia). Antes
 * se escribia ~/.agents/skills a mano y ignoraba esa variable. */
export function copiasSkill(entorno: Entorno): { nombre: string; coincide: boolean }[] {
  const origen = entorno.carpetaSkills;
  const copias = join(entorno.homedir, CARPETA_SKILLS_OPENCODE);
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
