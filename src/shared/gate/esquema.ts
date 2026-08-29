/* Esquema dirigido por datos para el editor/consola de gate (SENTINEL/VARSENSE).
 * [por que] Los archivos de gate los construyen los agentes y se equivocan:
 * omiten opciones, escriben con typos o usan el tipo incorrecto. El editor NO
 * puede depender de las claves que existan en el JSON; tiene que partir de un
 * esquema canonico y diagnosticar cada opcion contra el documento real.
 * Ahora este modelo vivia en src/v2/schemas; se movio aqui (src/shared/gate)
 * para que el SERVER (escaneo -> snapshot -> consola) y el EDITOR compartan la
 * misma fuente de verdad y no se desincronicen. */
import { descripcionDeRuta, nombreDeRuta } from './etiquetas.js';

export type ValorJson = boolean | number | string | null | ValorJson[] | { [k: string]: ValorJson };

export type TipoValor = 'string' | 'number' | 'boolean' | 'stringArray' | 'enum';

/* Necesidad de una opcion: define la severidad cuando FALTA.
 *   requerida   -> falta  => ERROR
 *   recomendada -> falta  => ADVERTENCIA
 *   opcional    -> falta  => no reporta nada
 * Un valor MAL TIPADO / enum invalido / clave desconocida es SIEMPRE error,
 * aunque la opcion fuera opcional. */
export type Necesidad = 'requerida' | 'recomendada' | 'opcional';

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
}

/* Un grupo (objeto) con opciones hijas. `permitirString` cubre los casos en
 * que el esquema acepta tambien una string (p.ej. `config` puede ser un
 * archivo `| string`). */
export interface NodoObjeto {
  objeto: Record<string, NodoEsquema>;
  permitirString?: boolean;
  necesidad?: Necesidad;
}

export type NodoEsquema =
  | OpcionValor
  | NodoObjeto
  /* Record<string, T> sin catalogo de ids conocido: se enumeran SOLO las
   * claves presentes en el JSON (p.ej. guard.directCommands). */
  | { mapa: NodoEsquema; necesidad?: Necesidad }
  /* Record<string, T> con un catalogo de ids conocido: se enumeran las claves
   * presentes Y los ids del catalogo que faltan (p.ej. rules). */
  | { mapaCatalogo: NodoEsquema; catalogo: string[]; necesidad?: Necesidad }
  /* Array de objetos: cada item se expande por indice. */
  | { listaDe: NodoEsquema; necesidad?: Necesidad };

export function necesidadDe(n: NodoEsquema): Necesidad {
  if ('tipo' in n) return n.necesidad ?? 'opcional';
  if ('objeto' in n) return n.necesidad ?? 'opcional';
  if ('mapa' in n) return n.necesidad ?? 'opcional';
  if ('mapaCatalogo' in n) return n.necesidad ?? 'opcional';
  return 'opcional';
}

/* ------------------------------------------------------------------ */
/* Rutas y utilidades de escritura sobre el JSON (controlado).         */
/* ------------------------------------------------------------------ */

/* Ruta a un valor dentro del JSON: secuencia de claves/indices. */
export type Ruta = (string | number)[];

/* Ruta como etiqueta legible (p.ej. "Analizadores › Sentinel › Configuración ›
 * Patrones incluidos"). [por que] El usuario pidio traducir las etiquetas
 * tecnicas a nombres legibles; el catalogo vive en ./etiquetas.js y hace
 * fallback al segmento tecnico si falta traduccion (nunca vacio). */
export function rutaEtiqueta(ruta: Ruta): string {
  return nombreDeRuta(ruta);
}

/* Descripcion corta de la ruta (la del segmento mas profundo que la tenga).
 * undefined si ningun segmento tiene descripcion. */
export function rutaDescripcion(ruta: Ruta): string | undefined {
  return descripcionDeRuta(ruta);
}

/* Default sensato por tipo de hoja (para insertar una opcion que falta).
 * [por que] Si una opcion no define `default` explicito (p.ej. las listas),
 * insertar `null` la deja marcada de tipo malo; mejor el vacio correcto. */
export function defaultValorDe(o: OpcionValor): ValorJson {
  if (o.default !== undefined) return o.default;
  switch (o.tipo) {
    case 'stringArray':
      return [];
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'enum':
      return o.valores?.[0] ?? '';
  }
  return null;
}

/* Devuelve el valor del esquema por defecto (para el boton "agregar").
 * [por que] El esquema de sentinel es auto-referente (`config` se anida al
 * mismo objeto), asi que hay que guardar contra ciclos para no reventar la
 * pila al generar defaults de grupos ausentes. */
export function defaultDe(n: NodoEsquema): ValorJson {
  const visto = new Set<NodoEsquema>();
  function rec2(nd: NodoEsquema): ValorJson {
    if (visto.has(nd)) return {};
    visto.add(nd);
    if ('tipo' in nd) return defaultValorDe(nd);
    if ('mapa' in nd || 'mapaCatalogo' in nd) return {};
    if ('listaDe' in nd) return [];
    const o: Record<string, ValorJson> = {};
    for (const k of Object.keys(nd.objeto).sort()) o[k] = rec2(nd.objeto[k]);
    return o;
  }
  return rec2(n);
}

/* Crea una copia del JSON con `nuevo` asignado en `ruta` (clonando lo minimo
 * y creando los objetos intermedios que falten). */
export function setRuta(val: ValorJson | undefined, ruta: Ruta, nuevo: ValorJson): ValorJson {
  if (ruta.length === 0) return nuevo;
  const [cab, ...resto] = ruta;
  if (typeof cab === 'number') {
    const arr = Array.isArray(val) ? [...val] : [];
    if (arr.length <= cab) arr[cab] = undefined as never;
    return arr.map((x, i) => (i === cab ? setRuta(x, resto, nuevo) : x)) as ValorJson;
  }
  const o: Record<string, ValorJson> =
    val !== null && typeof val === 'object' && !Array.isArray(val)
      ? { ...(val as Record<string, ValorJson>) }
      : {};
  o[cab] = setRuta(o[cab], resto, nuevo);
  return o;
}

/* Elimina `ruta` del JSON (para quitar claves desconocidas). */
export function borrarRuta(val: ValorJson | undefined, ruta: Ruta): ValorJson {
  if (ruta.length === 0 || val === undefined) return val as ValorJson;
  const [cab, ...resto] = ruta;
  if (typeof cab === 'number') {
    if (!Array.isArray(val)) return val;
    return val
      .map((x, i) => (i === cab ? borrarRuta(x, resto) : x))
      .filter((x, i) => !(i === cab && resto.length === 0)) as ValorJson;
  }
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return val;
  const o = { ...(val as Record<string, ValorJson>) };
  delete o[cab];
  return o;
}

/* ------------------------------------------------------------------ */
/* Diagnostico: compara esquema <-> JSON y emite el estado por fila.   */
/* ------------------------------------------------------------------ */

export type Fila =
  | { tipo: 'campo'; ruta: Ruta; estado: 'valido' | 'malTipo'; valor: ValorJson; opcion: OpcionValor }
  | { tipo: 'faltante'; ruta: Ruta; default: ValorJson; necesidad: Necesidad }
  | { tipo: 'desconocida'; ruta: Ruta; valor: ValorJson; sugerencia?: string };

/* Profundidad hasta la que una opcion FALTANTE se clasifica como error/warning.
 * [por que] El esquema de sentinel es recursivo (`config` se anida al mismo
 * objeto); clasificar todos los faltantes profundos seria ruido. Solo las
 * opciones de los primeros niveles (raiz del proyecto) reportan; lo profundo
 * se trata como opcional. Un valor MAL TIPADO o clave desconocida es error
 * siempre, sin importar la profundidad. */
export const PROFUNDIDAD_CLASIFICAR = 3;

function tipoOk(tipo: TipoValor, v: unknown): boolean {
  if (tipo === 'string') return typeof v === 'string';
  if (tipo === 'number') return typeof v === 'number';
  if (tipo === 'boolean') return typeof v === 'boolean';
  if (tipo === 'stringArray') return Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (tipo === 'enum') return typeof v === 'string';
  return false;
}

function enumValido(v: unknown, valores?: string[]): boolean {
  return typeof v === 'string' && !!valores && valores.includes(v);
}

/* Distancia de edicion (para la sugerencia de clave desconocida). */
function distancia(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[n];
}

/* Sugiere la clave conocida mas cercana (si no esta a mas de 2 ediciones). */
export function sugerir(clave: string, conocidas: Iterable<string>): string | undefined {
  let mejor: string | undefined;
  let dMejor = Infinity;
  for (const c of conocidas) {
    const d = distancia(clave, c);
    if (d < dMejor) {
      dMejor = d;
      mejor = c;
    }
  }
  if (mejor && dMejor > 0 && dMejor <= 2) return mejor;
  return undefined;
}

/* Severidad que reporta una fila en la consola (solo faltante segun necesidad;
 * malTipo/desconocida siempre error). */
export function severidadDe(fila: Fila): 'error' | 'advertencia' | null {
  if (fila.tipo === 'campo') return fila.estado === 'malTipo' ? 'error' : null;
  if (fila.tipo === 'desconocida') return 'error';
  return fila.necesidad === 'requerida' ? 'error' : fila.necesidad === 'recomendada' ? 'advertencia' : null;
}

export function diagnosticar(esquema: NodoEsquema, json: unknown): Fila[] {
  const filas: Fila[] = [];

  function isObj(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  /* fallback cuando el JSON tiene un valor donde el esquema espera un grupo. */
  const grupoInvalido = (): OpcionValor => ({ tipo: 'string', descripcion: 'tipo de grupo inválido' });

  function rec(n: NodoEsquema, v: unknown, ruta: Ruta): void {
    /* Severidad del faltante: solo los niveles poco profundos reportan. */
    const faltanteNecesidad = (nd: NodoEsquema): Necesidad => {
      if (ruta.length + 1 > PROFUNDIDAD_CLASIFICAR) return 'opcional';
      return necesidadDe(nd);
    };

    if ('tipo' in n) {
      if (v === undefined) {
        filas.push({ tipo: 'faltante', ruta, default: defaultValorDe(n), necesidad: faltanteNecesidad(n) });
        return;
      }
      if (n.tipo === 'enum') {
        const ok = enumValido(v, n.valores);
        filas.push({ tipo: 'campo', ruta, estado: ok ? 'valido' : 'malTipo', valor: v as ValorJson, opcion: n });
        return;
      }
      const ok = tipoOk(n.tipo, v);
      filas.push({ tipo: 'campo', ruta, estado: ok ? 'valido' : 'malTipo', valor: v as ValorJson, opcion: n });
      return;
    }

    if ('objeto' in n) {
      if (v === undefined) {
        filas.push({ tipo: 'faltante', ruta, default: defaultDe(n), necesidad: faltanteNecesidad(n) });
        return;
      }
      /* config puede ser una string (ruta a un archivo de config). */
      if (!isObj(v)) {
        if (n.permitirString && typeof v === 'string') {
          const op: OpcionValor = { tipo: 'string', descripcion: 'ruta a config, o expande el objeto' };
          filas.push({ tipo: 'campo', ruta, estado: 'valido', valor: v, opcion: op });
          return;
        }
        filas.push({ tipo: 'campo', ruta, estado: 'malTipo', valor: v as ValorJson, opcion: grupoInvalido() });
        return;
      }
      for (const k of Object.keys(n.objeto).sort()) {
        const existe = Object.prototype.hasOwnProperty.call(v, k);
        rec(n.objeto[k], existe ? v[k] : undefined, [...ruta, k]);
      }
      /* Claves presentes que el esquema no conoce. */
      const conocidas = new Set(Object.keys(n.objeto));
      for (const k of Object.keys(v).filter((k) => !conocidas.has(k)).sort()) {
        filas.push({
          tipo: 'desconocida',
          ruta: [...ruta, k],
          valor: v[k] as ValorJson,
          sugerencia: sugerir(k, conocidas),
        });
      }
      return;
    }

    if ('mapaCatalogo' in n) {
      if (v === undefined) {
        filas.push({ tipo: 'faltante', ruta, default: {}, necesidad: faltanteNecesidad(n) });
        return;
      }
      if (!isObj(v)) {
        filas.push({ tipo: 'campo', ruta, estado: 'malTipo', valor: v as ValorJson, opcion: grupoInvalido() });
        return;
      }
      const presentes = new Set(Object.keys(v));
      for (const k of Object.keys(v).sort()) rec(n.mapaCatalogo, v[k], [...ruta, k]);
      for (const id of (n.catalogo ?? [])) {
        if (!presentes.has(id)) {
          filas.push({ tipo: 'faltante', ruta: [...ruta, id], default: {}, necesidad: faltanteNecesidad(n) });
        }
      }
      return;
    }

    if ('mapa' in n) {
      if (v === undefined) {
        filas.push({ tipo: 'faltante', ruta, default: {}, necesidad: faltanteNecesidad(n) });
        return;
      }
      if (!isObj(v)) {
        filas.push({ tipo: 'campo', ruta, estado: 'malTipo', valor: v as ValorJson, opcion: grupoInvalido() });
        return;
      }
      for (const k of Object.keys(v).sort()) rec(n.mapa, v[k], [...ruta, k]);
      return;
    }

    /* listaDe */
    if (v === undefined) {
      filas.push({ tipo: 'faltante', ruta, default: [], necesidad: faltanteNecesidad(n) });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((it, i) => rec(n.listaDe, it, [...ruta, i]));
      return;
    }
    filas.push({ tipo: 'campo', ruta, estado: 'malTipo', valor: v as ValorJson, opcion: grupoInvalido() });
  }

  rec(esquema, json, []);
  return filas;
}