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
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, X } from 'lucide-react';
import type { NodoEsquema, OpcionValor, ValorJson } from '../shared/gate/esquema.js';
import {
  borrarRuta,
  diagnosticar,
  rutaDetalle,
  rutaEtiqueta,
  setRuta,
  type Fila,
  type Ruta,
} from '../shared/gate/esquema.js';
import { toastInfo } from './toast.js';

interface Props {
  esquema: NodoEsquema;
  value: ValorJson | undefined;
  onChange: (v: ValorJson) => void;
  readOnly?: boolean;
}

export function EditorEsquema({ esquema, value, onChange, readOnly }: Props) {
  const filas = diagnosticar(esquema, value);
  if (filas.length === 0) {
    return <div className="fjVacio">sin opciones</div>;
  }
  const setEn = (ruta: Ruta, nuevo: ValorJson) => onChange(setRuta(value, ruta, nuevo));

  return (
    <div className="fjPlano">
      {filas.map((f, i) => (
        <Fila key={i} fila={f} setEn={setEn} quitar={readOnly ? undefined : (r) => onChange(borrarRuta(value, r))} readOnly={readOnly} />
      ))}
    </div>
  );
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
            <button type="button" className="ejQuitar" onClick={() => quitar(fila.ruta)} title="quitar clave desconocida">
              quitar
            </button>
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

/* Nombre legible de la ruta tecnica de la opcion, con TOOLTIP personalizado
 * monocromo que muestra SOLO la descripcion detallada de la opcion al pasar el
 * cursor. [por que] El usuario pidio que el tooltip muestre unicamente la
 * descripcion detallada: repetir el nombre o la ruta tecnica es redundante
 * porque la ruta ya se lee en la propia etiqueta. Se usa
 * un portal al body para que el tooltip no se recorte por el overflow de los
 * paneles con scroll. */
function EtiquetaDeRuta({ ruta }: { ruta: Ruta }) {
  const detalle = rutaDetalle(ruta);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function mostrar(e: React.MouseEvent) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const ANCHO = 340;
    let x = r.left;
    if (x + ANCHO > window.innerWidth - 8) x = Math.max(8, window.innerWidth - ANCHO - 8);
    const y = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 180));
    setPos({ x, y });
  }

  return (
    <span
      ref={ref}
      className="ejRutaTexto"
      onMouseEnter={mostrar}
      onMouseLeave={() => setPos(null)}
    >
      <span className="ejRutaNombre">{rutaEtiqueta(ruta)}</span>
      {pos &&
        detalle &&
        createPortal(
          <div className="ejTooltip" style={{ left: pos.x, top: pos.y }} role="tooltip">
            <span className="ejTooltipDetalle">{detalle}</span>
          </div>,
          document.body,
        )}
    </span>
  );
}

/* Control segun el tipo de opcion (sin JSON crudo). */
function Control({
  value,
  opcion,
  onChange,
  readOnly,
}: {
  value: ValorJson;
  opcion: OpcionValor;
  onChange: (v: ValorJson) => void;
  readOnly?: boolean;
}) {
  if (opcion.tipo === 'stringArray') {
    const valores = Array.isArray(value) && value.every((v) => typeof v === 'string')
      ? (value as string[])
      : [];
    return <TagLista valores={valores} onCambiar={onChange} readOnly={readOnly} />;
  }
  if (opcion.tipo === 'enum') {
    return <ControlEnum value={typeof value === 'string' ? value : ''} valores={opcion.valores ?? []} onChange={onChange} readOnly={readOnly} />;
  }
  if (opcion.tipo === 'boolean') {
    const on = value === true;
    if (readOnly) return <span className="fjVacio">{on ? 'sí' : 'no'}</span>;
    return (
      <button type="button" className={`fjSwitch${on ? ' fjSwitch--on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on}>
        <span className="fjSwitchPalo" />
      </button>
    );
  }
  if (opcion.tipo === 'number') {
    if (readOnly) return <span className="fjVacio">{String(value)}</span>;
    return (
      <input
        type="number"
        className="fjInput fjInput--num"
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isNaN(n) ? value : n);
        }}
      />
    );
  }
  /* string */
  if (readOnly) return <span className="ejValorTexto">{value === null ? '—' : String(value)}</span>;
  return (
    <input
      type="text"
      className="fjInput"
      value={value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* Select monocromo para opciones tipo enum (severidad, etc.). */
function ControlEnum({
  value,
  valores,
  onChange,
  readOnly,
}: {
  value: string;
  valores: string[];
  onChange: (v: ValorJson) => void;
  readOnly?: boolean;
}) {
  if (readOnly) return <span className="ejValorTexto">{value || '—'}</span>;
  const opciones = valores.includes(value) ? valores : [...valores, value];
  return (
    <select className="fjSelect" value={value} onChange={(e) => onChange(e.target.value)}>
      {opciones.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

/* Lista de valores simples (string[]) como tags editables. */
function TagLista({
  valores,
  onCambiar,
  readOnly,
}: {
  valores: string[];
  onCambiar: (v: ValorJson) => void;
  readOnly?: boolean;
}) {
  const [nuevo, setNuevo] = useState('');
  function agregar() {
    const txt = nuevo.trim();
    if (!txt) {
      toastInfo('escribe un valor');
      return;
    }
    onCambiar([...valores, txt]);
    setNuevo('');
  }
  return (
    <div className="fjTags">
      {valores.length === 0 && <div className="fjVacio">vacío</div>}
      <div className="fjTagsLista">
        {valores.map((t, i) =>
          readOnly ? (
            <span className="fjTag fjTag--ro" key={`${t}-${i}`}>
              {t}
            </span>
          ) : (
            <span className="fjTag" key={`${t}-${i}`}>
              <input
                className="fjTagInput"
                value={t}
                onChange={(e) => onCambiar([...valores.slice(0, i), e.target.value, ...valores.slice(i + 1)])}
                aria-label={`valor ${i + 1}`}
              />
              <button type="button" className="fjTagQuitar" onClick={() => onCambiar(valores.filter((_, j) => j !== i))} title="quitar" aria-label="quitar">
                ×
              </button>
            </span>
          ),
        )}
      </div>
      {readOnly ? null : (
        <div className="fjAgregar">
          <input
            className="fjInput fjInput--nuevo"
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && agregar()}
            placeholder="agregar valor…"
          />
          <button type="button" className="fjBoton" onClick={agregar}>
            agregar
          </button>
        </div>
      )}
    </div>
  );
}

/* Valor crudo de una clave desconocida (resumen, no editable). */
function ValorCrudo({ valor }: { valor: ValorJson }) {
  if (valor === null) return <span className="ejValorTexto">null</span>;
  if (typeof valor === 'object') {
    try {
      return <span className="ejValorTexto">{JSON.stringify(valor)}</span>;
    } catch {
      return <span className="ejValorTexto">?</span>;
    }
  }
  return <span className="ejValorTexto">{String(valor)}</span>;
}