/* Formulario JSON generico que se ve como una pagina normal de ajustes
 * (settings). [por que] Las versiones previas (arbol de cajas, grupos
 * apilados) «funcionaban» pero se veian raras y desordenadas. Esta version
 * usa el patrón clasico de formulario: cada objeto es una seccion con
 * titulo visible, cada clave es una fila horizontal [ etiqueta | control ],
 * los booleanos son un switch y las listas de valores son tags en linea.
 * Las secciones vienen ABIERTAS por defecto para que el panel se llene de
 * contenido y no deje un hueco enorme (cada una es colapsable). Sigue
 * siendo generico: ninguna clave/regla esta hardcodeada. */
import { useState } from 'react';
import { toastInfo } from './toast.js';

export type JsonValue = boolean | number | string | null | JsonValue[] | { [k: string]: JsonValue };

interface Props {
  value: JsonValue;
  onChange: (v: JsonValue) => void;
  etiqueta?: string;
  /* profundidad: los objetos anidados (>=1) son colapsables. */
  profundo?: number;
  tituloRaiz?: string;
}

/* Seccion con titulo visible y colapso para los niveles internos. */
function Seccion({
  titulo,
  conteo,
  colapsable,
  children,
}: {
  titulo: string;
  conteo: number;
  colapsable: boolean;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(true);
  return (
    <div className="fjSec">
      <button
        type="button"
        className={`fjSecCab${abierto ? ' fjSecCab--abierta' : ''}`}
        onClick={() => colapsable && setAbierto((a) => !a)}
        aria-expanded={abierto}
      >
        {colapsable && <span className="fjFlecha">{abierto ? '▾' : '▸'}</span>}
        <span className="fjTitulo">{titulo}</span>
        <span className="fjConteo">({conteo})</span>
      </button>
      {abierto && <div className="fjSecCuerpo">{children}</div>}
    </div>
  );
}

export function EditorJson({ value, onChange, etiqueta, profundo = 0 }: Props) {
  const esArr = Array.isArray(value);
  const esObj = value !== null && typeof value === 'object' && !esArr;

  if (esArr) {
    return (
      <Seccion titulo={etiqueta ?? 'lista'} conteo={(value as unknown[]).length} colapsable={false}>
        <EditorArray value={value} onChange={onChange} />
      </Seccion>
    );
  }

  if (esObj) {
    const obj = value as { [k: string]: JsonValue };
    const claves = Object.keys(obj).sort();
    const titulo = etiqueta ?? 'configuración';
    return (
      <Seccion titulo={titulo} conteo={claves.length} colapsable={profundo >= 1}>
        {claves.length === 0 && <div className="fjVacio">sin opciones</div>}
        {claves.map((k) => {
          const v = obj[k];
          const interno = Array.isArray(v) || (v !== null && typeof v === 'object');
          /* Valor simple -> fila horizontal [ etiqueta | control ]. */
          if (!interno) {
            return (
              <div className="fjFila" key={k}>
                <span className="fjEtiqueta">{k}</span>
                <span className="fjControl">
                  <ControlSimple
                    value={v}
                    onChange={(nv) => onChange({ ...obj, [k]: nv })}
                  />
                </span>
              </div>
            );
          }
          /* Valor anidado -> su propia seccion (colapsada a partir del 2do nivel). */
          return (
            <EditorJson
              key={k}
              value={v}
              onChange={(nv) => onChange({ ...obj, [k]: nv })}
              etiqueta={k}
              profundo={profundo + 1}
            />
          );
        })}
      </Seccion>
    );
  }

  return <ControlSimple value={value} onChange={onChange} />;
}

/* Control para un valor simple, apilado dentro de .fjControl. */
function ControlSimple({ value, onChange }: { value: JsonValue; onChange: (v: JsonValue) => void }) {
  if (value === null) return <span className="fjVacio">—</span>;
  if (typeof value === 'boolean') {
    return (
      <button type="button" className={`fjSwitch${value ? ' fjSwitch--on' : ''}`} onClick={() => onChange(!value)} aria-pressed={value}>
        <span className="fjSwitchPalo" />
      </button>
    );
  }
  if (typeof value === 'number') {
    return (
      <input type="number" className="fjInput fjInput--num" value={String(value)}
        onChange={(e) => { const n = Number(e.target.value); onChange(Number.isNaN(n) ? value : n); }} />
    );
  }
  return <input type="text" className="fjInput" value={value as string} onChange={(e) => onChange(e.target.value)} />;
}

/* Array: si es de primitivas, tags en linea; si es de objetos, items. */
function EditorArray({ value, onChange }: { value: JsonValue[]; onChange: (v: JsonValue) => void }) {
  const todosPrimitivos = value.every((v) => v === null || typeof v !== 'object');
  if (todosPrimitivos) {
    return (
      <TagLista
        valores={(value as (string | number | boolean | null)[]).map((x) => String(x))}
        onCambiar={(vals) =>
          onChange(
            vals.map((t) => (t === 'true' ? true : t === 'false' ? false : t)),
          )
        }
      />
    );
  }
  return (
    <ListaObjetos items={value} onChange={onChange} />
  );
}

/* Tags en linea editables para listas de valores simples. */
function TagLista({ valores, onCambiar }: { valores: string[]; onCambiar: (v: string[]) => void }) {
  const [nuevo, setNuevo] = useState('');
  function agregar() {
    const txt = nuevo.trim();
    if (!txt) { toastInfo('escribe un valor'); return; }
    onCambiar([...valores, txt]);
    setNuevo('');
  }
  if (valores.length === 0) {
    return (
      <div className="fjAgregar">
        <input className="fjInput fjInput--nuevo" value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregar()} placeholder="agregar valor…" />
        <button type="button" className="fjBoton" onClick={agregar}>agregar</button>
      </div>
    );
  }
  return (
    <div className="fjTags">
      <div className="fjTagsLista">
        {valores.map((t, i) => (
          <span className="fjTag" key={`${t}-${i}`}>
            <input className="fjTagInput" value={t} onChange={(e) => onCambiar([...valores.slice(0, i), e.target.value, ...valores.slice(i + 1)])} aria-label={`valor ${i + 1}`} />
            <button type="button" className="fjTagQuitar" onClick={() => onCambiar(valores.filter((_, j) => j !== i))} title="quitar" aria-label="quitar">×</button>
          </span>
        ))}
      </div>
      <div className="fjAgregar">
        <input className="fjInput fjInput--nuevo" value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregar()} placeholder="agregar valor…" />
        <button type="button" className="fjBoton" onClick={agregar}>agregar</button>
      </div>
    </div>
  );
}

/* Lista de objetos: cada item editable con indice. */
function ListaObjetos({ items, onChange }: { items: JsonValue[]; onChange: (v: JsonValue[]) => void }) {
  function itemNuevo(): JsonValue {
    if (items.length === 0) return {};
    const primero = items[0];
    if (primero !== null && typeof primero === 'object' && !Array.isArray(primero)) {
      const patron = { ...(primero as { [k: string]: JsonValue }) };
      for (const k of Object.keys(patron)) {
        const v = patron[k];
        if (typeof v === 'string') patron[k] = '';
        else if (typeof v === 'boolean') patron[k] = false;
        else if (Array.isArray(v)) patron[k] = [];
      }
      return patron;
    }
    return {};
  }
  return (
    <div className="fjLista">
      {items.length === 0 && <div className="fjVacio">vacío</div>}
      {items.map((item, i) => (
        <div className="fjItem" key={i}>
          <div className="fjItemCab">
            <span className="fjItemIndex">item #{i + 1}</span>
            <button type="button" className="fjTagQuitar" onClick={() => onChange(items.filter((_, j) => j !== i))} title="quitar item" aria-label="quitar item">×</button>
          </div>
          <EditorJson value={item} onChange={(nv) => onChange([...items.slice(0, i), nv, ...items.slice(i + 1)])} profundo={1} />
        </div>
      ))}
      <div className="fjAgregar">
        <button type="button" className="fjBoton" onClick={() => onChange([...items, itemNuevo()])}>agregar item</button>
      </div>
    </div>
  );
}