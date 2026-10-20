/* Rutas del JSON de un gate y utilidades de escritura sobre él: etiquetas legibles, defaults por
 * tipo y setRuta/borrarRuta sin mutar. Puro. Reexportado desde esquema.ts, así que los
 * importadores no cambian. [por que] Partido de esquema.ts para bajar del límite de 300 líneas. */
import { descripcionDeRuta, detalleDeRuta, nombreDeRuta } from '../etiquetas/etiquetas.js';
import type { NodoEsquema, OpcionValor, ValorJson } from './esquema.js';

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

/* Detalle explicativo de la ruta (para el tooltip del editor): el `detalle`
 * del segmento mas profundo que lo tenga, o su descripcion corta si no hay
 * detalle. undefined si ningun segmento tiene texto. */
export function rutaDetalle(ruta: Ruta): string | undefined {
  return detalleDeRuta(ruta);
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
