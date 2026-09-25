/* Controles del EditorEsquema segun el tipo de opcion (sin JSON crudo).
 * [por que] Viven en modulo propio para que EditorEsquema.tsx no supere el
 * limite de lineas. */
import { useState } from 'react';
import { Button } from './ui/Button.js';
import { Selector } from './ui/selector/Selector.js';
import { toastInfo } from './toast.js';
import type { OpcionValor, ValorJson } from '../shared/gate/esquema.js';

/* Control segun el tipo de opcion (sin JSON crudo). */
export function Control({
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
      <Button className={`fjSwitch${on ? ' fjSwitch--on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on}>
        <span className="fjSwitchPalo" />
      </Button>
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

/* Select monocromo del sistema para opciones tipo enum (severidad, etc.).
 * [por que] html-nativo-en-vez-de-componente exige el Selector DS en vez del
 * <select> nativo. */
export function ControlEnum({
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
  return <Selector valor={value} opciones={opciones} onChange={(v) => onChange(v)} />;
}

/* Lista de valores simples (string[]) como tags editables. */
export function TagLista({
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
              <Button className="fjTagQuitar" onClick={() => onCambiar(valores.filter((_, j) => j !== i))} title="quitar" aria-label="quitar">
                ×
              </Button>
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
          <Button className="fjBoton" onClick={agregar}>
            agregar
          </Button>
        </div>
      )}
    </div>
  );
}

/* Valor crudo de una clave desconocida (resumen, no editable). */
export function ValorCrudo({ valor }: { valor: ValorJson }) {
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
