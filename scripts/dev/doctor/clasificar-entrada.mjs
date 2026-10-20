/* Entrada del registro que describe a un proyecto: funcion PURA (sin disco ni red).
 * [por que] Se separa de clasificar.mjs para que el nucleo con E/S quede solo con
 * sondas y procesos. */

import { isAbsolute, resolve } from 'node:path';

import { RAIZ_REPO } from './base.mjs';
import { normalizarRuta } from './sistema/procesos.mjs';

/* Entrada del registro que describe al proyecto `p` (por ruta o por id de aviso). */
export function entradaDeProyecto(p, registro) {
  return [...registro.entradas.values()].find(
    (e) =>
      (typeof e.ruta === 'string' &&
        normalizarRuta(isAbsolute(e.ruta) ? e.ruta : resolve(RAIZ_REPO, e.ruta)) === normalizarRuta(p.ruta)) ||
      (e._avisoRegistro && e.id === p.clave),
  );
}
