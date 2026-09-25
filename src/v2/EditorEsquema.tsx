/* Editor de gate dirigido por esquema (reemplaza a EditorJson).
 * [por que] Los archivos de gate los construyen los agentes y se equivocan:
 * omiten opciones, escriben con typos o usan el tipo incorrecto. En lugar de
 * derivar las opciones de las claves que EXISTEN en el JSON, recorre un
 * ESQUEMA canónico (src/v2/schemas) para mostrar TODAS las opciones validas:
 *   - presente y valida        -> valor con marca ✓
 *   - presente pero MAL tipo   -> marca ⚠ (corregible, sin JSON crudo)
 *   - falte                    -> fila con boton "+ agregar" (inserta default)
 *   - clave desconocida (typo) -> fila ✗ con la clave valida mas cercana
 * El componente sigue siendo controlado sobre el valor real del JSON, y deja
 * intactas las claves desconocidas no tocadas al guardar. Mantiene el diseno
 * plano aprobado (una fila por ruta, 11px, sin :hover). */
import { AlertTriangle, Check, X } from 'lucide-react';
import type { NodoEsquema, OpcionValor, ValorJson } from '../shared/gate/esquema.js';
import {
  borrarRuta,
  diagnosticar,
  setRuta,
  type Fila,
  type Ruta,
} from '../shared/gate/esquema.js';
import { REGLAS as REGLAS_ESTATICAS, type ReglaCatalogo } from '../shared/gate/reglas.js';
import { Button } from './ui/Button.js';
import { SeccionReglas } from './SeccionReglas.js';
import { Control, ValorCrudo } from './controlesEsquema.js';
import { EtiquetaDeRuta } from './EtiquetaDeRuta.js';

interface Props {
  esquema: NodoEsquema;
  value: ValorJson | undefined;
  onChange: (v: ValorJson) => void;
  readOnly?: boolean;
  /* Catalogo de reglas para SeccionReglas. [por que] R1 gate-dinamico: si el
   * consumidor lo inyecta (vivo desde /api/gate/reglas), se usan las reglas
   * reales del runtime; si no, cae al estatico embebido. El editor nunca
   * importa el snapshot congelado directamente. */
  reglas?: ReglaCatalogo[];
}

export function EditorEsquema({ esquema, value, onChange, readOnly, reglas }: Props) {
  const filas = diagnosticar(esquema, value);
  /* Catalogo de reglas del esquema (nodo mapaCatalogo de la raiz, p.ej. `rules`
   * en sentinel). Si existe, las filas de esa clave NO se renderizan como filas
   * planas: van a la seccion dedicada SeccionReglas. [por que] El usuario pidio
   * que las reglas se vean en una seccion aparte con todas las reglas del
   * catalogo, activables/desactivables, en lugar de filas sueltas
   * `Reglas > id > Habilitada`. Generico: se descubre del esquema, sin claves
   * hardcodeadas. */
  const catalogo = buscarCatalogo(esquema);
  const filasPlanas = catalogo ? filas.filter((f) => f.ruta[0] !== catalogo.clave) : filas;
  if (filas.length === 0 && !catalogo) {
    return <div className="fjVacio">sin opciones</div>;
  }
  const setEn = (ruta: Ruta, nuevo: ValorJson) => onChange(setRuta(value, ruta, nuevo));
  const valorCatalogo =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, ValorJson>)[catalogo?.clave ?? '']
      : undefined;

  return (
    <div className="fjPlano">
      {catalogo && (
      <SeccionReglas
        clave={catalogo.clave}
        item={catalogo.item}
        reglas={reglas ?? REGLAS_ESTATICAS}
        valor={valorCatalogo}
        setEn={setEn}
        readOnly={readOnly}
      />
      )}
      {/* key estable: la ruta del esquema identifica la fila de forma única. */}
      {filasPlanas.map((f) => (
        <Fila key={f.ruta.join('/')} fila={f} setEn={setEn} quitar={readOnly ? undefined : (r) => onChange(borrarRuta(value, r))} readOnly={readOnly} />
      ))}
    </div>
  );
}

/* Descubre el nodo catalogo (mapaCatalogo con ids) de la raiz del esquema.
 * [por que] La seccion de reglas no debe depender de la clave exacta
 * (`rules`): cualquier esquema con un mapa+catalogo en la raiz obtiene la
 * seccion dedicada sin tocar el componente. */
function buscarCatalogo(esquema: NodoEsquema): { clave: string; item: NodoEsquema; ids: string[] } | null {
  if (!('objeto' in esquema)) return null;
  for (const [clave, n] of Object.entries(esquema.objeto)) {
    if ('mapaCatalogo' in n && Array.isArray(n.catalogo) && n.catalogo.length > 0) {
      return { clave, item: n.mapaCatalogo, ids: n.catalogo };
    }
  }
  return null;
}

function Fila({
  fila,
  setEn,
  quitar,
  readOnly,
}: {
  fila: Fila;
  setEn: (r: Ruta, v: ValorJson) => void;
  quitar?: (r: Ruta) => void;
  readOnly?: boolean;
}) {
  if (fila.tipo === 'faltante') {
    return (
      <FilaFaltante fila={fila} setEn={setEn} readOnly={readOnly} />
    );
  }

  if (fila.tipo === 'desconocida') {
    return (
      <div className="ejEstado ejEstado--desconocida">
        <span className="ejEtiqueta">
          <X size={12} className="ejMarca" aria-hidden />
          <EtiquetaDeRuta ruta={fila.ruta} />
          <span className="ejMarcaTexto">desconocida</span>
        </span>
        <span className="ejControl">
          <ValorCrudo valor={fila.valor} />
          {fila.sugerencia && <span className="ejSugerencia">¿era “{fila.sugerencia}”?</span>}
          {quitar ? (
            <Button className="ejQuitar" onClick={() => quitar(fila.ruta)} title="quitar clave desconocida">
              quitar
            </Button>
          ) : null}
        </span>
      </div>
    );
  }

  /* campo: valido o malTipo */
  return (
    <div className={`fjFila${fila.estado === 'malTipo' ? ' fjFila--mal' : ''}`}>
      <span className="fjEtiqueta">
        {fila.estado === 'malTipo' ? (
          <AlertTriangle size={12} className="ejMarca" aria-hidden />
        ) : (
          <Check size={12} className="ejMarca" aria-hidden />
        )}
        <EtiquetaDeRuta ruta={fila.ruta} />
      </span>
      <span className="fjControl">
        <Control value={fila.valor} opcion={fila.opcion} onChange={(v) => setEn(fila.ruta, v)} readOnly={readOnly} />
      </span>
    </div>
  );
}

/* Fila de una opcion FALTANTE: muestra, cuando el esquema define un default
 * real, ese valor directamente en la fila; y un boton "+ agregar" que lo
 * inserta via setRuta (controlado). [por que] El usuario pidio que se vean los
 * valores por defecto definidos, pero sin mini-form (lo encontraba confuso);
 * si la opcion NO define un default real (listas de strings, grupos, mapas),
 * no se muestra ningun valor y solo queda el boton de agregar. */
function FilaFaltante({
  fila,
  setEn,
  readOnly,
}: {
  fila: Extract<Fila, { tipo: 'faltante' }>;
  setEn: (r: Ruta, v: ValorJson) => void;
  readOnly?: boolean;
}) {
  /* Default REAL: solo hojas cuyo esquema fija `default` explicitamente. Un
   * grupo/mapa/sin default no muestra valor fantasma (solo queda + agregar). */
  const defaultReal =
    fila.nodo !== null && typeof fila.nodo === 'object' && 'tipo' in fila.nodo
      ? (fila.nodo as OpcionValor).default
      : undefined;

  /* [por que] El usuario pidio que el valor por defecto se vea como si ya
   * estuviera puesto en su columna de valor, transparente/fantasma (no como
   * texto en el titulo ni en un mini-form). Al hacer click sobre el valor
   * fantasma se inserta (setRuta) y pasa a ser el valor real editable. */
  return (
    <div className="ejEstado ejEstado--falte">
      <span className="ejEtiqueta">
        <EtiquetaDeRuta ruta={fila.ruta} />
      </span>
      <span className="ejControl">
        {defaultReal !== undefined && !readOnly ? (
          <button
            type="button"
            className="ejDefaultGhost"
            onClick={() => setEn(fila.ruta, fila.default)}
            title="haz clic para usar este valor por defecto"
          >
            {formatDefault(defaultReal)}
            <span className="ejAgregarMini">＋</span>
          </button>
        ) : readOnly ? null : (
          <button
            type="button"
            className="ejAgregar"
            onClick={() => setEn(fila.ruta, fila.default)}
            title="agregar esta opción con su valor por defecto"
          >
            + agregar
          </button>
        )}
      </span>
    </div>
  );
}

/* SeccionReglas, nombreRegla y categoriaNombre viven en ./SeccionReglas.js. */


/* Formatea un valor por defecto real para mostrarlo inline en la fila.
 * [por que] El usuario pidio que se vea el valor por defecto directamente,
 * legible (no JSON crudo): booleanos como si/no, listas como contenedoras
 * separadas por comas, objetos como su resumen. */
function formatDefault(v: ValorJson): string {
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (Array.isArray(v)) {
    return v.length === 0 ? '[]' : v.map((x) => String(x)).join(', ');
  }
  if (v !== null && typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '{…}';
    }
  }
  return String(v);
}

/* EtiquetaDeRuta vive en ./EtiquetaDeRuta.js; Control, ControlEnum, TagLista y
 * ValorCrudo viven en ./controlesEsquema.js. */
