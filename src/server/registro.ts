/* Puerta unica a la config privada del area (config/registro.json).
 * [por que] Varios modulos abrian el fichero por su cuenta y cada uno volvia a
 * derivar lo mismo: que apps del area son ajenas. La lectura y esa derivacion
 * viven aqui, y quien las necesite las pide; el resto de campos del registro
 * los interpreta cada modulo, que es quien sabe que busca.
 * El fichero es privado y vive fuera del repo (ver config/ejemplos/). */
import { readFileSync } from 'node:fs';
import { rutaConfigPrivada } from '../shared/rutas.js';

/* Forma minima que aqui se usa. El resto del registro (proyectos, vps,
 * ignoradosSistema...) lo interpreta quien lo necesita. */
export interface RegistroArea {
  proyectos?: unknown[];
  noAplica?: Record<string, unknown>;
}

/* Motivo con el que el registro declara una app que NO es del area: alguien de
 * fuera la gestiona, asi que el tablero ni la denuncia ni la toca. */
export const GESTION_EXTERNA = 'gestion-externa';

/* Lee el registro. Lanza si falta o no es JSON: sin registro no hay area que
 * gobernar, y quien llama decide si eso es un aviso o un error. */
export function leerRegistroArea(): RegistroArea {
  return JSON.parse(readFileSync(rutaConfigPrivada('registro.json'), 'utf8')) as RegistroArea;
}

/* Marcas (subcadenas, en minusculas) de las apps ajenas al area: las que el
 * registro declara `gestion-externa`. [por que] Cuales son es configuracion,
 * no codigo: antes habia un literal con el nombre de una incrustado en las
 * reglas de conformidad y en el limpiador. Vacio = no hay ninguna exenta. */
export function appsAjenas(registro: RegistroArea): string[] {
  return Object.entries(registro.noAplica ?? {})
    .filter(([, motivo]) => motivo === GESTION_EXTERNA)
    .map(([id]) => id.toLowerCase());
}
