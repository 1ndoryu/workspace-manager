/* Lo que el registro declara para la conformidad del taller: sesiones dev, hostnames públicos,
 * puertos públicos, sitios Rust y apps ajenas. Lo lee el servidor; la regla es pura en
 * shared/taller/conformidad.ts. [por que] Sacado de estado.ts para mantener cada módulo bajo el
 * límite de líneas. */
import { readFileSync } from 'node:fs';
import type { RegistroConformidad } from '../../shared/taller/conformidad.js';
import { rutaConfigPrivada } from '../plataforma/rutas.js';
import { sesionDev } from '../../shared/taller/sesiones.js';
import { appsAjenas } from '../registro.js';

const RUTA_REGISTRO = rutaConfigPrivada('registro.json');

interface ProyectoRegistro {
  id?: unknown;
  host?: unknown;
  puertos?: unknown;
  puertosRemotos?: unknown;
  hostsPublicos?: unknown;
  puertosPublicos?: unknown;
  buildMode?: unknown;
}

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const numeros = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

/* Lo que el registro declara y debe cumplirse. Sitios Rust: solo los que declaran buildMode;
 * un Rust sin declarar no se evalúa (cobertura limitada, dicho en el resumen). */
export function leerRegistroConformidad(): RegistroConformidad {
  const crudo = JSON.parse(readFileSync(RUTA_REGISTRO, 'utf8')) as {
    proyectos?: ProyectoRegistro[];
    noAplica?: Record<string, unknown>;
  };
  const sesionesDev: string[] = [];
  const hostsPublicos = new Set<string>();
  const sesionesDevPorHost: Record<string, string[]> = {};
  const puertosLocalesPublicos = new Set<number>();
  const sitiosRust: RegistroConformidad['sitiosRust'] = [];
  for (const p of crudo.proyectos ?? []) {
    const id = typeof p.id === 'string' ? p.id : '';
    if (!id) continue;
    /* [por que] Las sesiones tmux remotas se llaman dev-<id>-<puerto> (scripts/dev/remoto.mjs:27)
     * y el puerto es el remoto (puertosRemotos ?? puertos, remoto.mjs:30). */
    const sesiones: string[] = [];
    if (typeof p.host === 'string' && p.host !== '') {
      for (const puerto of numeros(p.puertosRemotos ?? p.puertos)) sesiones.push(sesionDev(id, puerto));
    }
    sesionesDev.push(...sesiones);
    textos(p.hostsPublicos).forEach((h) => {
      hostsPublicos.add(h);
      sesionesDevPorHost[h] = [...(sesionesDevPorHost[h] ?? []), ...sesiones];
    });
    numeros(p.puertosPublicos).forEach((n) => puertosLocalesPublicos.add(n));
    if ('buildMode' in p) sitiosRust.push({ id, buildMode: typeof p.buildMode === 'string' ? p.buildMode : null });
  }
  /* Apps ajenas al área: las que el registro marca `gestion-externa`. No son
   * nuestros proyectos, así que L1 no las denuncia ni las manda parar. */
  return {
    sesionesDev,
    hostsPublicos: [...hostsPublicos],
    sesionesDevPorHost,
    puertosLocalesPublicos: [...puertosLocalesPublicos],
    sitiosRust,
    ajenos: appsAjenas(crudo),
  };
}
