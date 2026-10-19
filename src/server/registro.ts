/* Puerta unica a la config privada del area (config/registro.json).
 * [por que] Varios modulos abrian el fichero por su cuenta y cada uno volvia a
 * derivar lo mismo: que apps del area son ajenas. La lectura y esa derivacion
 * viven aqui, y quien las necesite las pide; el resto de campos del registro
 * los interpreta cada modulo, que es quien sabe que busca.
 * El fichero es privado y vive fuera del repo (ver config/ejemplos/). */
import { readFileSync } from 'node:fs';
import { rutaConfigPrivada } from './plataforma/rutas.js';
import type { Despliegue, Ejecucion, Proyecto } from '../shared/tipos/proyecto.js';

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

/* Lectura para el escaner: sin fichero el tablero sigue, solo sin vinculos.
 * [por que] Solo se tolera la ausencia (ENOENT); un JSON roto sigue siendo error. */
export function leerRegistroOpcional(): RegistroArea {
  try {
    return leerRegistroArea();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/* Forma de una ficha del registro que este modulo interpreta (el resto la
 * interpretan sus dueños). */
interface FichaRegistro {
  id?: string;
  host?: string;
  modo?: string;
  buildMode?: string;
  despliegue?: Despliegue;
}

/* Vincula cada proyecto con su ficha: donde corre el dev, en que modo y su
 * despliegue en Coolify. [por que] El registro es la unica fuente de estos
 * datos; el escaner no los deduce del disco. Sin ficha, el proyecto queda igual. */
export function anotarRegistro(proyectos: Proyecto[], registro: RegistroArea): Proyecto[] {
  const fichas = new Map<string, FichaRegistro>();
  for (const entrada of registro.proyectos ?? []) {
    const ficha = entrada as FichaRegistro;
    if (ficha.id) fichas.set(ficha.id, ficha);
  }
  return proyectos.map((p) => {
    const ficha = fichas.get(p.id);
    if (!ficha) return p;
    const anotado: Proyecto = { ...p, ejecucion: ejecucionDe(ficha) };
    if (ficha.despliegue) anotado.despliegue = ficha.despliegue;
    return anotado;
  });
}

/* Solo la ficha de la 89 declara `host`; sin host el dev corre en el laptop. */
function ejecucionDe(ficha: FichaRegistro): Ejecucion {
  const modo = ficha.modo ?? ficha.buildMode;
  return {
    donde: ficha.host ? 'vps89' : 'laptop',
    modo: modo === 'build' || modo === 'dev' ? modo : null,
  };
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
