/* Lectura de las skills del mando Arranque y de sus copias en opencode. Es E/S de disco.
 * [por que] Separada de recoger.ts (19AA-13). */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { leerArchivo } from '../../http.js';
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
 * ~/.agents/skills: solo se comparan las skills que existen en el origen. */
export function copiasSkill(entorno: Entorno): { nombre: string; coincide: boolean }[] {
  const origen = join(entorno.homedir, '.agents', 'skills');
  const copias = join(entorno.homedir, '.config', 'opencode', 'skills');
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
