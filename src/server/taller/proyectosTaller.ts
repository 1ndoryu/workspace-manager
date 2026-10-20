/* Proyectos del taller para la tabla del panel (20AA-16).
 * [por que] La fila la manda el registro, no pulse: pulse solo ve lo que está vivo en la 89, y un
 * proyecto parado tiene que seguir teniendo fila (en `apagado`) con su sesión y su hostname, igual
 * que en la tab vps lo detenido lo aporta la lista de Coolify. Puro: el registro entra por
 * parámetro y así se prueba sin disco ni SSH. */
import { sesionDev } from '../../shared/taller/sesiones.js';
import type { ProyectoTaller } from '../../shared/taller/proyecto.js';

/* [por que] Reexport: el tipo es compartido con el frente (shared/taller/proyecto.ts) y quien
 * importa este módulo ya lo espera aquí. */
export type { ProyectoTaller };

interface FichaTaller {
  id?: unknown;
  host?: unknown;
  dominio?: unknown;
  puertos?: unknown;
  puertosRemotos?: unknown;
  puertosLocales?: unknown;
  hostsPublicos?: unknown;
}

const numeros = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];

const textos = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

/* Un proyecto del taller es el que tiene host (corre en la 89) y al menos un puerto: sin puerto no
 * hay sesión que arrancar ni fila que enseñar (el escritorio VNC, sentinel o varsense se quedan
 * fuera, no son despliegues del taller). `puertosRemotos: []` es un «no expongas nada», no un
 * «usa los de siempre»: el fallback a `puertos` es solo cuando el campo no está. */
export function proyectosDelTaller(crudo: unknown): ProyectoTaller[] {
  const fichas = (crudo as { proyectos?: FichaTaller[] } | null)?.proyectos ?? [];
  const salida: ProyectoTaller[] = [];
  for (const f of fichas) {
    const id = typeof f?.id === 'string' ? f.id : '';
    if (id === '' || typeof f.host !== 'string' || f.host === '') continue;
    const remotos = numeros(f.puertosRemotos ?? f.puertos);
    if (remotos.length === 0) continue;
    const locales = numeros(f.puertosLocales);
    const publicos = textos(f.hostsPublicos);
    salida.push({
      id,
      sesiones: remotos.map((puerto) => sesionDev(id, puerto)),
      puertoLocal: locales[0] ?? remotos[0] ?? null,
      hostname: publicos[0] ?? (typeof f.dominio === 'string' && f.dominio !== '' ? f.dominio : null),
    });
  }
  return salida.sort((a, b) => a.id.localeCompare(b.id));
}
