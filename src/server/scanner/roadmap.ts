/* Resumen del roadmap.md de un proyecto: tareas pendientes y IDs activos.
 * [por que] roadmap.md es la fuente de trabajo abierto del area; el manager
 * debe poder mostrar pendientes e IDs sin parsear el documento completo.
 * [gotcha] Las casillas `- [ ]` NO llevan el ID en la misma linea: los IDs
 * (297A-4, H-F12-14, F0…) aparecen en el contexto. Pendientes = casillas sin
 * marcar; IDs = coincidencias en todo el documento. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResumenRoadmap } from '../../shared/types.js';

/* Patrones de IDs usados en el area:
 * - {DD}{M}{A}-{N} (ej: 297A-4, 058A-1, 024A-12)
 * - H-<dominio>-<n>-<m> (ej: H-F12-14, H-B03-06, H-F15-03)
 * - Fases tipo F0, T7 */
const RE_ID = /\b(?:\d{2,3}[A-C][A-Z]?-\d+|[A-Z]-[A-Z]+\d+-\d+|[A-Z]+\d+)\b/g;

/** Extrae un resumen compacto del roadmap.md. */
export function resumenRoadmap(ruta: string): ResumenRoadmap {
  const archivo = join(ruta, 'roadmap.md');
  if (!existsSync(archivo)) {
    return { pendientes: 0, activos: 0, ids: [], resumen: '' };
  }
  try {
    const texto = readFileSync(archivo, 'utf8');
    const lineas = texto.split(/\r?\n/);

    /* Pendientes: casillas sin marcar */
    const pendientes = lineas.filter((l) => /^\s*[-*]\s+\[ \]/.test(l)).length;

    /* IDs unicos de todo el documento (contexto incluido) */
    const ids = new Set<string>();
    for (const linea of lineas) {
      const m = linea.match(RE_ID);
      if (m) m.forEach((id) => ids.add(id));
    }

    /* Activos: bloques con estado "en curso/activo/siguiente bloque" */
    const activos = lineas.filter((l) =>
      /en curso|activo|siguiente bloque|bloque actual/i.test(l),
    ).length;

    const resumen = lineas
      .filter((l) => /^\s*[-*]\s+\[ \]/.test(l))
      .map((l) => l.replace(/^\s*[-*]\s+\[ \]\s*/, '').trim())
      .slice(0, 8)
      .join(' · ');

    return {
      pendientes,
      activos,
      ids: [...ids].slice(0, 40),
      resumen,
    };
  } catch {
    return { pendientes: 0, activos: 0, ids: [], resumen: '' };
  }
}

