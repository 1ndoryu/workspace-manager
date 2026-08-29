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
import { useState } from 'react';
import type { NodoEsquema, OpcionValor, ValorJson } from './schemas/types.js';
import {
  borrarRuta,
  diagnosticar,
  rutaEtiqueta,
  setRuta,
  type Fila,
  type Ruta,
} from './schemas/types.js';
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
      <div className="ejEstado ejEstado--falte">
        <span className="ejEtiqueta">{rutaEtiqueta(fila.ruta)}</span>
        {readOnly ? null : (
          <button
            type="button"
            className="ejAgregar"
            onClick={() => setEn(fila.ruta, fila.default)}
            title="agregar esta opción con su valor por defecto"
          >
            + agregar
          </button>
        )}
      </div>
    );
  }

  if (fila.tipo === 'desconocida') {
    return (
      <div className="ejEstado ejEstado--desconocida">
        <span className="ejEtiqueta">
          {rutaEtiqueta(fila.ruta)}
          <span className="ejMarca">✗ desconocida</span>
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
        {fila.estado === 'malTipo' ? <span className="ejMarca">⚠</span> : <span className="ejMarca">✓</span>}
        <span className="ejRutaLabel">{rutaEtiqueta(fila.ruta)}</span>
      </span>
      <span className="fjControl">
        <Control value={fila.valor} opcion={fila.opcion} onChange={(v) => setEn(fila.ruta, v)} readOnly={readOnly} />
      </span>
    </div>
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