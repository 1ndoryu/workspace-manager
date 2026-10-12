/* Lenguaje llano de la pestaña Guardián: traduce los términos del guard (enforce,
 * observe, plantilla…) a frases que se entienden sin conocer su contrato.
 * [por que] La pestaña mostraba los valores crudos del servidor y era difícil de
 * leer. Aquí se decide una vez cómo se nombra cada cosa; los componentes solo
 * piden el texto. Sin React: se prueba como datos. */
import type { ModoGuard, ProyectoArea } from './tiposGuardian.js';

export const MODO_LLANO: Record<ModoGuard, string> = {
  enforce: 'bloquea',
  observe: 'solo avisa',
  'pass-through': 'no actúa',
};

export interface FilaResumen {
  clave: string;
  comandos: string;
  limites: string;
  bloqueos: number;
  /* Lo que conviene revisar de este proyecto; vacío si está en orden. */
  revisar: string[];
}

export function resumenProyecto(p: ProyectoArea): FilaResumen {
  const revisar: string[] = [];
  if (p.politica.config !== 'ok') revisar.push(`configuración ${p.politica.config}`);
  if (p.listas.estado === 'invalida') revisar.push(`reglas inválidas: ${p.listas.motivo}`);
  const d = p.diferencias;
  if (d.estado === 'ok' && d.faltan.length + d.reaparecen.length > 0) {
    revisar.push(`difiere de la plantilla (${d.faltan.length + d.reaparecen.length})`);
  }
  const comandos =
    p.listas.estado === 'ok' ? MODO_LLANO[p.listas.modo] : p.listas.estado === 'ausente' ? 'sin reglas' : 'reglas inválidas';
  return {
    clave: p.clave,
    comandos,
    limites: MODO_LLANO[p.politica.modo],
    bloqueos: p.totalBloqueados,
    revisar,
  };
}
