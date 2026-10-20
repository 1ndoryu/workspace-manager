/* Esquema dirigido por datos para el editor/consola de gate (SENTINEL/VARSENSE).
 * [por que] Los archivos de gate los construyen los agentes y se equivocan:
 * omiten opciones, escriben con typos o usan el tipo incorrecto. El editor NO
 * puede depender de las claves que existan en el JSON; tiene que partir de un
 * esquema canonico y diagnosticar cada opcion contra el documento real.
 * Ahora este modelo vivia en src/v2/schemas; se movio aqui (src/shared/gate)
 * para que el SERVER (escaneo -> snapshot -> consola) y el EDITOR compartan la
 * misma fuente de verdad y no se desincronicen. */

export type ValorJson = boolean | number | string | null | ValorJson[] | { [k: string]: ValorJson };

export type TipoValor = 'string' | 'number' | 'boolean' | 'stringArray' | 'enum';

/* Necesidad de una opcion: define la severidad cuando FALTA.
 *   requerida   -> falta  => ERROR
 *   recomendada -> falta  => ADVERTENCIA
 *   opcional    -> falta  => no reporta nada
 * Un valor MAL TIPADO / enum invalido / clave desconocida es SIEMPRE error,
 * aunque la opcion fuera opcional. */
export type Necesidad = 'requerida' | 'recomendada' | 'opcional';

/* Rutas alternativas donde el runtime acepta la opcion si no esta en su
 * posicion canonica. `'*'` comodina CUALQUIER clave de objeto (p.ej. el
 * nombre del analizador en `analyzers.*.config`). [por que] El esquema de
 * sentinel acepta patterns en la raiz O dentro de `analyzers…config`;
 * declararlo aqui evita que el diagnostico marque "falta" una opcion que
 * el proyecto ya tiene en su ubicacion alternativa valida (falso positivo). */
export type Alternativas = string[][];

/* Una hoja: una opcion concreta con un valor. */
export interface OpcionValor {
  tipo: TipoValor;
  /* Para 'enum': valores permitidos. */
  valores?: string[];
  /* Valor por defecto real del esquema; se inserta al "agregar". */
  default?: ValorJson;
  descripcion?: string;
  /* La necesidad por defecto es 'opcional': solo las opciones etiquetadas
   * como requeridas/recomendadas generan error/warning si faltan. */
  necesidad?: Necesidad;
  /* Ubicaciones alternativas validas (ver Alternativas). */
  alternativas?: Alternativas;
}

/* Un grupo (objeto) con opciones hijas. `permitirString` cubre los casos en
 * que el esquema acepta tambien una string (p.ej. `config` puede ser un
 * archivo `| string`). */
export interface NodoObjeto {
  objeto: Record<string, NodoEsquema>;
  permitirString?: boolean;
  necesidad?: Necesidad;
  alternativas?: Alternativas;
}

export type NodoEsquema =
  | OpcionValor
  | NodoObjeto
  /* Record<string, T> sin catalogo de ids conocido: se enumeran SOLO las
   * claves presentes en el JSON (p.ej. guard.directCommands). */
  | { mapa: NodoEsquema; necesidad?: Necesidad; alternativas?: Alternativas }
  /* Record<string, T> con un catalogo de ids conocido: se enumeran las claves
   * presentes Y los ids del catalogo que faltan (p.ej. rules). */
  | { mapaCatalogo: NodoEsquema; catalogo: string[]; necesidad?: Necesidad; alternativas?: Alternativas }
  /* Array de objetos: cada item se expande por indice. */
  | { listaDe: NodoEsquema; necesidad?: Necesidad; alternativas?: Alternativas };

export * from './esquema-ruta.js';
export * from './esquema-diagnostico.js';
