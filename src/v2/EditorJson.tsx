/* Editor JSON legible y generico: renderiza cualquier valor recursivamente,
 * sin hardcodear ninguna regla concreta. [por que] El usuario pidio poder
 * activar/desactivar opciones y agregar/quitar reglas de sentinel/varsense de
 * forma legible, con TODAS las claves del JSON real visibles y editables.
 *
 * Mapeo de tipos -> control:
 *   boolean            -> toggle si/no
 *   number             -> input numerico
 *   string             -> input de texto
 *   string[]           -> lista editable (quitar + agregar)
 *   objeto plano       -> bloque con una fila por clave (anidado recursivo)
 *   array de objetos   -> lista editable de bloques
 *   null / vacio       -> etiqueta "vacío"
 *
 * Es un componente controlado: recibe la raiz (unknown) y eleva los cambios
 * con onChange(nuevoValor). La serializacion/validacion la hace el padre. */
import { useState, type ChangeEvent } from 'react';
import { toastInfo } from './toast.js';

/* Tipos JSON admitidos de forma recursiva. */
export type JsonValue = boolean | number | string | null | JsonValue[] | { [k: string]: JsonValue };

interface Props {
  value: JsonValue;
  onChange: (v: JsonValue) => void;
  ruta?: string;
}

/* Ayuda visual: clave de fila con opacidad diferenciada segun profundidad. */
const RELLENO = { 0: '', 1: '12px', 2: '8px' } as const;

export function EditorJson({ value, onChange, ruta = '' }: Props) {
  const esObj = value !== null && typeof value === 'object' && !Array.isArray(value);
  const esArr = Array.isArray(value);

  if (esObj) {
    const obj = value as { [k: string]: JsonValue };
    const claves = Object.keys(obj).sort();
    const profundidad = ruta ? ruta.split('/').length : 0;
    const padding = RELLENO[profundidad as keyof typeof RELLENO] ?? '4px';
    return (
      <div className="ejObjeto" style={{ paddingLeft: padding }}>
        {claves.length === 0 && <div className="ejVacio">objeto vacío</div>}
        {claves.map((k) => (
          <div className="ejFila" key={k}>
            <span className="ejClave">{k}</span>
            <div className="ejControl">
              <EditorJson
                value={obj[k]}
                onChange={(nv) => onChange({ ...obj, [k]: nv })}
                ruta={ruta ? `${ruta}/${k}` : k}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (esArr) {
    return <EditorArray value={value} onChange={onChange} ruta={ruta} />;
  }

  return <EditorPrimitiva value={value} onChange={onChange} ruta={ruta} />;
}

/* Array: lista de items editables con quitar, mas agregar. El tipo del item
 * nuevo se infiere del primer item existente (o string[] si vacio). */
function EditorArray({ value, onChange, ruta }: { value: JsonValue[]; onChange: (v: JsonValue) => void; ruta: string }) {
  const [nuevo, setNuevo] = useState('');

  /* Si todos los items son strings u objetos, tratamos como lista de
   * "reglas"; si son objetos, cada item se edita como objeto. */
  const sonStrings = value.every((v) => typeof v === 'string');
  const sonPrimitivas = value.every((v) => typeof v !== 'object' || v === null);

  /* Crea la plantilla de un item nuevo: para arrays de objetos usa las
   * claves del primer item; para primitivas usa ''/false/0 segun el tipo. */
  function itemNuevo(): JsonValue {
    if (value.length === 0) return '';
    const primero = value[0];
    if (primero !== null && typeof primero === 'object' && !Array.isArray(primero)) {
      const patron = { ...(primero as { [k: string]: JsonValue }) };
      /* [por que] Al agregar un objeto, los strings se vacian y los flags
       * booleanos se apagan: el usuario rellena lo suyo sin copiar valores. */
      for (const k of Object.keys(patron)) {
        const v = patron[k];
        if (typeof v === 'string') patron[k] = '';
        else if (typeof v === 'boolean') patron[k] = false;
      }
      return patron;
    }
    if (typeof primero === 'boolean') return false;
    if (typeof primero === 'number') return 0;
    return '';
  }

  function agregar() {
    if (sonStrings) {
      const txt = nuevo.trim();
      if (!txt) {
        toastInfo('escribe la regla a agregar');
        return;
      }
      onChange([...value, txt]);
      setNuevo('');
      return;
    }
    onChange([...value, itemNuevo()]);
  }

  if (value.length === 0) {
    return (
      <div className="ejArrVacio">
        <span className="ejVacio">vacío</span>
        <button type="button" className="ejBoton" onClick={agregar}>
          agregar
        </button>
      </div>
    );
  }

  return (
    <div className="ejLista" style={{ paddingLeft: ruta ? '4px' : undefined }}>
      {value.map((item, i) => {
        const clave = typeof item === 'string' ? `"${item}"` : String(i + 1);
        return (
          <div className="ejListaItem" key={i}>
            {sonPrimitivas ? (
              <>
                <span className="ejIndice">{clave}</span>
                <div className="ejControl">
                  <EditorPrimitiva
                    value={item as boolean & number & string}
                    onChange={(nv) => onChange([...value.slice(0, i), nv, ...value.slice(i + 1)])}
                    ruta={`${ruta}/${i}`}
                  />
                </div>
              </>
            ) : (
              <div className="ejControl">
                <EditorJson
                  value={item}
                  onChange={(nv) => onChange([...value.slice(0, i), nv, ...value.slice(i + 1)])}
                  ruta={`${ruta}/${i}`}
                />
              </div>
            )}
            <button
              type="button"
              className="ejQuitar"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              title="quitar"
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="ejAgregar">
        {sonStrings ? (
          <input
            type="text"
            className="ejInput"
            value={nuevo}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') agregar();
            }}
            placeholder="nueva regla"
          />
        ) : (
          <span className="ejVacio">item</span>
        )}
        <button type="button" className="ejBoton" onClick={agregar}>
          agregar
        </button>
      </div>
    </div>
  );
}

/* Primitiva (boolean / number / string / null): un control proporcional. */
function EditorPrimitiva({
  value,
  onChange,
}: {
  value: boolean | number | string | null;
  onChange: (v: JsonValue) => void;
  ruta: string;
}) {
  if (value === null) {
    return <span className="ejVacio">null</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <button
        type="button"
        className={`ejToggle${value ? ' ejToggle--on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        {value ? 'sí' : 'no'}
      </button>
    );
  }
  if (typeof value === 'number') {
    return (
      <input
        type="number"
        className="ejInput ejInput--num"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isNaN(n) ? value : n);
        }}
      />
    );
  }
  return (
    <input
      type="text"
      className="ejInput"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}