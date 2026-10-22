/* Reglas puras del alta de proyectos: textos, listas canonicas y resultados (sin disco ni git).
 * [por que] Lo que el alta exige vive aparte de la E/S para que cambiar una lista no obligue
 * a releer las comprobaciones. */

import { resolve } from 'node:path';

export const ok = (nombre, detalle) => ({ nombre, ok: true, detalle });
export const fallo = (nombre, detalle, accion, plan = {}) => ({ nombre, ok: false, detalle, accion, ...plan });
export const omitida = (nombre, motivo) => ({ nombre, ok: true, detalle: `omitida: ${motivo}` });

export const CARPETAS_AGENTE = ['completados', 'documentacion', 'lecciones', 'planes', 'prevencion'];
export const GITIGNORE = ['target/', 'node_modules/', '.quality-reports/', '.runtime/'];
export const MANIFIESTOS = [
  ['package.json', 'node'],
  ['Cargo.toml', 'rust'],
  ['pyproject.toml', 'python'],
  ['requirements.txt', 'python'],
  ['go.mod', 'go'],
];
export const AGENTS_PROPIOS = ['AGENTS.md', 'CLAUDE.md'];
export const ROADMAP_PLANTILLA = '# Roadmap\n\nTrabajo abierto y orden de ejecución. Historial en `Agente/completados/`; planes en `Agente/planes/` (AGENTS §7.1).\n';
export const MENSAJES = {
  docs: 'chore(alta): README, roadmap y Agente/ mínimos (10AA-2 F10)',
  gitignore: 'chore(alta): .gitignore de artefactos (10AA-2 F10)',
};
export const RAMA_ALTA = 'alta/10aa-2';
export const norma = (p) => resolve(p).replace(/\\/g, '/').toLowerCase();

/* El registro vive en el mando (workspace-manager), no en el proyecto: aplicar no lo escribe. */
export function comprobarRegistro(entrada) {
  if (!entrada) {
    return fallo('registro', 'sin entrada en registro.json', 'añádela con la skill dev-bootstrap (aplicar no escribe en el mando)');
  }
  return ok('registro', `entrada «${entrada.id}»`);
}
