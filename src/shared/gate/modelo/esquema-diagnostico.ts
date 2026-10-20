/* Diagnóstico del gate: compara el esquema con el JSON real y emite una fila por opción
 * (campo, faltante, desconocida). Puro. Reexportado desde esquema.ts. */
import type { Alternativas, NodoEsquema, OpcionValor, TipoValor, ValorJson, Necesidad } from './esquema.js';
import { defaultDe, defaultValorDe } from './esquema-ruta.js';
import type { Ruta } from './esquema-ruta.js';

export function necesidadDe(n: NodoEsquema): Necesidad {
  if ('tipo' in n) return n.necesidad ?? 'opcional';
  if ('objeto' in n) return n.necesidad ?? 'opcional';
  if ('mapa' in n) return n.necesidad ?? 'opcional';
  if ('mapaCatalogo' in n) return n.necesidad ?? 'opcional';
  return 'opcional';
}

/* ------------------------------------------------------------------ */
/* Diagnostico: compara esquema <-> JSON y emite el estado por fila.   */
/* ------------------------------------------------------------------ */

export type Fila =
  | { tipo: 'campo'; ruta: Ruta; estado: 'valido' | 'malTipo'; valor: ValorJson; opcion: OpcionValor }
  /* Enriquecida con `nodo` para que el UI muestre el default real de una
   * opcion que falta (fantasma inline) sin hardcodear claves. */
  | { tipo: 'faltante'; ruta: Ruta; default: ValorJson; necesidad: Necesidad; nodo: NodoEsquema }
  | { tipo: 'desconocida'; ruta: Ruta; valor: ValorJson; sugerencia?: string };

/* Busca si `clave` existe en alguna ubicacion alternativa declarada por la
 * opcion (`n.alternativas`). `'*'` en la ruta comodina cualquier clave de
 * objeto (p.ej. el nombre del analizador en `analyzers.*.config`).
 * [por que] Sentinel acepta los patterns en la raiz O dentro de
 * `analyzers…config`; si el proyecto los tiene en la alternativa valida, la
 * opcion NO falta: suprimir el falso "falta" de la consola/editor. */
export function existeAlternativa(json: unknown, alternativas: Alternativas | undefined, clave: string): boolean {
  if (!alternativas || alternativas.length === 0 || clave === '') return false;
  for (const alt of alternativas) {
    if (buscarEnRuta(json, [...alt, clave], 0)) return true;
  }
  return false;
}

function buscarEnRuta(v: unknown, ruta: (string | number)[], i: number): boolean {
  if (i >= ruta.length) return true;
  const seg = ruta[i];
  if (seg === '*') {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    return (Object.values(v) as unknown[]).some((x) => buscarEnRuta(x, ruta, i + 1));
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  if (!(seg in v)) return false;
  return buscarEnRuta((v as Record<string, unknown>)[seg], ruta, i + 1);
}

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

  /* Objetos (Record de hijos) que ya estan siendo recorridos en la pila actual.
   * [por que] El esquema de sentinel es auto-referente (`config` apunta al mismo
   * `contenido` de la raiz). Sin esta guarda, cada nivel recursivo vuelve a
   * enumerar TODO el esquema como "falta" (`Configuracion > Analizadores`,
   * `> Gate`, `> Reglas`...), duplicando las opciones de la raiz. Al detectar la
   * re-entrada por identidad se activa el modo `eco`: se siguen validando los
   * valores PRESENTES (malTipo, claves desconocidas -> errores reales), pero se
   * suprimen las filas "falta" duplicadas, que solo son ecos de la recursion. */
  const pilaObjetos = new Set<Record<string, NodoEsquema>>();

  function rec(n: NodoEsquema, v: unknown, ruta: Ruta, echo: boolean): void {
    /* Severidad del faltante: solo los niveles poco profundos reportan. */
    const faltanteNecesidad = (nd: NodoEsquema): Necesidad => {
      if (ruta.length + 1 > PROFUNDIDAD_CLASIFICAR) return 'opcional';
      return necesidadDe(nd);
    };

    if ('tipo' in n) {
      if (v === undefined) {
        /* En modo eco la opcion ya se ofrecio en su lugar canonico (raiz); y si
         * existe en una ubicacion alternativa valida (p.ej. dentro de
         * analyzers…config), tampoco falta. */
        if (!echo && !existeAlternativa(json, n.alternativas, String(ruta[ruta.length - 1] ?? ''))) {
          filas.push({ tipo: 'faltante', ruta, default: defaultValorDe(n), necesidad: faltanteNecesidad(n), nodo: n });
        }
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
        if (!echo && !existeAlternativa(json, n.alternativas, String(ruta[ruta.length - 1] ?? ''))) {
          filas.push({ tipo: 'faltante', ruta, default: defaultDe(n), necesidad: faltanteNecesidad(n), nodo: n });
        }
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
      /* Re-entrada al mismo Record de hijos (recursion): el subarbol es un eco. */
      const eco = echo || pilaObjetos.has(n.objeto);
      pilaObjetos.add(n.objeto);
      for (const k of Object.keys(n.objeto).sort()) {
        const existe = Object.prototype.hasOwnProperty.call(v, k);
        rec(n.objeto[k], existe ? v[k] : undefined, [...ruta, k], eco);
      }
      pilaObjetos.delete(n.objeto);
      /* Claves presentes que el esquema no conoce (error real, incluso en eco). */
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
        if (!echo && !existeAlternativa(json, n.alternativas, String(ruta[ruta.length - 1] ?? ''))) {
          filas.push({ tipo: 'faltante', ruta, default: {}, necesidad: faltanteNecesidad(n), nodo: n });
        }
        return;
      }
      if (!isObj(v)) {
        filas.push({ tipo: 'campo', ruta, estado: 'malTipo', valor: v as ValorJson, opcion: grupoInvalido() });
        return;
      }
      const presentes = new Set(Object.keys(v));
      for (const k of Object.keys(v).sort()) rec(n.mapaCatalogo, v[k], [...ruta, k], echo);
      for (const id of (n.catalogo ?? [])) {
        if (!presentes.has(id)) {
          /* [por que] Un id del catalogo sin entrada usa su valor por defecto en el
           * runtime: no es una opcion que falte. Se enumera (el editor la muestra)
           * pero como `opcional`, para no avisar 105 veces en la consola (falso positivo). */
          if (!echo) filas.push({ tipo: 'faltante', ruta: [...ruta, id], default: {}, necesidad: 'opcional', nodo: n.mapaCatalogo });
        }
      }
      return;
    }

    if ('mapa' in n) {
      if (v === undefined) {
        if (!echo && !existeAlternativa(json, n.alternativas, String(ruta[ruta.length - 1] ?? ''))) {
          filas.push({ tipo: 'faltante', ruta, default: {}, necesidad: faltanteNecesidad(n), nodo: n });
        }
        return;
      }
      if (!isObj(v)) {
        filas.push({ tipo: 'campo', ruta, estado: 'malTipo', valor: v as ValorJson, opcion: grupoInvalido() });
        return;
      }
      for (const k of Object.keys(v).sort()) rec(n.mapa, v[k], [...ruta, k], echo);
      return;
    }

    /* listaDe */
    if (v === undefined) {
      if (!echo && !existeAlternativa(json, n.alternativas, String(ruta[ruta.length - 1] ?? ''))) {
        filas.push({ tipo: 'faltante', ruta, default: [], necesidad: faltanteNecesidad(n), nodo: n });
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((it, i) => rec(n.listaDe, it, [...ruta, i], echo));
      return;
    }
    filas.push({ tipo: 'campo', ruta, estado: 'malTipo', valor: v as ValorJson, opcion: grupoInvalido() });
  }

  rec(esquema, json, [], false);
  return filas;
}