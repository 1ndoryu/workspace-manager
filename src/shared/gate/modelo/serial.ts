/* Serializacion JSON del esquema (NodoEsquema) preservando identidad compartida.
 * [por que] El esquema de sentinel es auto-referente: `config` apunta al MISMO
 * objeto `contenido` de la raiz (ciclo). JSON.stringify normal revienta con
 * "Converting circular structure". Ademas, `diagnosticar()` usa identidad de
 * objeto (`pilaObjetos.has`) para suprimir el eco recursivo; si al rehidratar
 * duplicamos el subarbol en vez de compartirlo, esa guarda deja de funcionar y
 * el diagnostico vuelve a inundarse de filas "falta" en cada nivel de recursion.
 *
 * Solucion: cada objeto unico (nodo de esquema O valor anidado) vive UNA sola
 * vez en la tabla `__nodos`; el grafo se expresa con punteros `{ __nodoRef: <id> }`
 * y `raiz` es `{ __nodoRef: <id> }`. Nunca se serializa el mismo objeto dos
 * veces, asi que al rehidratar toda referencia resuelve al MISMO objeto y la
 * identidad compartida sobrevive. Sin `eval`: las referencias se resuelven por
 * indice en la tabla, no por paths. */
import type { NodoEsquema } from './esquema.js';

interface Ref { __nodoRef?: number }
interface DocGrafo { __nodos?: unknown[]; __raiz?: Ref }

function esObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/* Appianta el grafo del esquema a pares { __nodos, __raiz }. Cada objeto unico
 * (nodo o valor) se guarda en __nodos y se referencia por indice; los objetos
 * compartidos (recursion de sentinel) apuntan al mismo id. */
export function serializarEsquema(raiz: NodoEsquema): string {
  const ids = new Map<object, number>();

  /* Primera pasada: asigna un id unico a cada objeto/array alcanzable. */
  function rot(x: unknown): void {
    if (!esObj(x)) return;
    if (ids.has(x)) return;
    ids.set(x, ids.size);
    if (Array.isArray(x)) x.forEach(rot);
    else for (const k of Object.keys(x)) rot(x[k]);
  }
  rot(raiz);

  const tabla: unknown[] = new Array(ids.size);
  /* Segunda pasada: cada entrada reemplaza sus hijos-objeto por punteros. */
  for (const [obj, id] of ids) {
    const refDe = (c: unknown): unknown => (esObj(c) && ids.has(c) ? { __nodoRef: ids.get(c) } : c);
    tabla[id] = Array.isArray(obj)
      ? obj.map(refDe)
      : (() => {
          const o: Record<string, unknown> = {};
          const oo = obj as Record<string, unknown>;
          for (const k of Object.keys(oo)) o[k] = refDe(oo[k]);
          return o;
        })();
  }

  return JSON.stringify({ __nodos: tabla, __raiz: { __nodoRef: ids.get(raiz) } });
}

/* Rehidrata el JSON de `serializarEsquema`, restaurando las referencias
 * compartidas como el MISMO objeto (identidad). Devuelve el NodoEsquema. */
export function deserializarEsquema(texto: string): NodoEsquema {
  const doc = JSON.parse(texto) as DocGrafo;
  const tabla = doc.__nodos ?? [];
  const raizId = doc.__raiz?.__nodoRef;
  if (typeof raizId !== 'number' || raizId < 0 || raizId >= tabla.length) {
    throw new Error('esquema serializado invalido: falta raiz');
  }

  const resueltos: Array<unknown | null> = new Array(tabla.length).fill(null);

  /* Materializa el nodo `id`, creandolo ANTES de llenar sus hijos para cortar
   * los ciclos: una ref al nodo actual devuelve el objeto ya reservado. */
  function materializar(id: number, pila: Map<number, unknown>): unknown {
    if (resueltos[id] !== null) return resueltos[id];
    if (pila.has(id)) return pila.get(id);
    const ser = tabla[id];
    if (Array.isArray(ser)) {
      const arr: unknown[] = new Array(ser.length);
      resueltos[id] = arr;
      pila.set(id, arr);
      ser.forEach((c, i) => {
        arr[i] = esObj(c) && typeof c.__nodoRef === 'number' ? materializar(c.__nodoRef as number, pila) : c;
      });
      pila.delete(id);
      return arr;
    }
    const o: Record<string, unknown> = {};
    resueltos[id] = o;
    pila.set(id, o);
    for (const k of Object.keys(ser as Record<string, unknown>)) {
      const c = (ser as Record<string, unknown>)[k];
      o[k] = esObj(c) && typeof c.__nodoRef === 'number' ? materializar(c.__nodoRef as number, pila) : c;
    }
    pila.delete(id);
    return o;
  }

  return materializar(raizId, new Map()) as NodoEsquema;
}