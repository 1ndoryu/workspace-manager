/* Funciones puras de la pestaña Guardián: traducen las respuestas de edición a la
 * vista previa que enseña la pestaña. Sin React, para poder probarlas como datos.
 * [por que] Las respuestas de edición traen `motivo` solo cuando no son escribibles
 * (conflicto o error): aquí se decide una vez qué se muestra y si se puede confirmar. */
import type { BloqueDiff, RespuestaEdicion, RespuestaLote, RespuestaTopes } from './tiposGuardian.js';

export interface BloqueVista {
  etiqueta: string;
  diff: BloqueDiff | null;
}

export interface VistaPrevia {
  bloques: BloqueVista[];
  cambia: boolean;
  /* Motivo del servidor cuando la vista no se puede confirmar. */
  motivo?: string;
}

export function vistaDeEdicion(r: RespuestaEdicion, etiqueta: string): VistaPrevia {
  if (r.estado !== 'ok') return { bloques: [], cambia: false, motivo: r.motivo };
  return { bloques: [{ etiqueta, diff: r.diff }], cambia: r.cambia };
}

export type ErrorTopes = Extract<RespuestaTopes, { estado: 'conflicto' | 'error' }>;

/* [por que] Un 500 de topes significa que la confirmación falló a medio camino:
 * el usuario debe saber que sentinel.config.json volvió a su estado anterior. */
export function textoErrorTopes(r: ErrorTopes): string {
  return r.configRevertida ? `${r.motivo}. Se revirtió sentinel.config.json.` : r.motivo;
}

export function vistaDeTopes(r: RespuestaTopes): VistaPrevia {
  if (r.estado !== 'ok') return { bloques: [], cambia: false, motivo: textoErrorTopes(r) };
  return {
    bloques: [
      { etiqueta: 'config', diff: r.diffConfig },
      { etiqueta: 'extra', diff: r.diffExtra },
    ],
    cambia: r.cambia,
  };
}

/* Null si el lote se aplicó; si no, el texto que explica qué falló. */
export function motivoLote(r: RespuestaLote): string | null {
  if ('error' in r) return r.error;
  if (r.estado === 'ok') return null;
  const fallos = r.resultados
    .filter((x) => x.estado !== 'ok')
    .map((x) => `${x.clave}: ${x.motivo ?? x.estado}`);
  return fallos.join(' · ') || 'lote no aplicado';
}
