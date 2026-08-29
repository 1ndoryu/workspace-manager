/* Formulario JSON legible y generico: en vez de editar el JSON crudo o un
 * arbol de cajas, renderiza el valor como un formulario ordenado apilado:
 * cada grupo es una tarjeta con titulo, cada clave una fila con su etiqueta
 * ARRIBA y el control DEBAJO (vertical). [por que] El usuario pidio una
 * interfaz normal, no un arbol: el apilado vertical elimina las columnas
 * que se colapsaban y deja claro que es cada campo. Sigue siendo generico:
 * ninguna regla/el clave esta hardcodeada.
 *
 * Mapeo de tipos -> control (siempre funciona con datos reales):
 *   boolean -> toggle sí/no
 *   string  -> input de texto
 *   number  -> input numerico
 *   string[]-> lista de tags editables (quitar + agregar)
 *   objeto  -> tarjeta anidada "titulo"
 *   array de objetos -> lista de tarjetas editables (agregar/quitar)
 *   null/vacio -> etiqueta "—"
 *
 * Componente controlado: onChange(nuevoValor). La serializacion la hace el
 * padre al guardar. */
import { useState, type ChangeEvent } from 'react';
import { toastInfo } from './toast.js';

export type JsonValue = boolean | number | string | null | JsonValue[] | { [k: string]: JsonValue };

interface Props {
  value: JsonValue;
  onChange: (v: JsonValue) => void;
  etiqueta?: string;
  /* Nivel de profundidad para alternar tarjetas con/sin borde. */
  profundo?: number;
}
/* Construye una tarjeta de grupo con titulo propio. */
function Grupo({
  titulo,
  conteo,
  children,
}: {
  titulo: string;
  conteo: number;
  children: React.ReactNode;
}) {
  return (
    <div className="fjGrupo">
      <header className="fjGrupoCab">
        <span className="fjGrupoTitulo">{titulo}</span>
        <span className="fjGrupoConteo">({conteo})</span>
      </header>
      <div className="fjGrupoCuerpo">{children}</div>
    </div>
  );
}

/* Fila de campo: etiqueta arriba, control debajo (vertical). */
function Campo({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <label className="fjCampo">
      <span className="fjCampoEtiqueta">{etiqueta}</span>
      <span className="fjCampoControl">{children}</span>
    </label>
  );
}

/* Fila de campo dentro de un grupo, sin borde de tarjeta adicional. */
function CampoLinea({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <label className="fjCampo fjCampo--linea">
      <span className="fjCampoEtiqueta">{etiqueta}</span>
      <span className="fjCampoControl">{children}</span>
    </label>
  );
}

export function EditorJson({ value, onChange, etiqueta, profundo = 0 }: Props) {
  const esArr = Array.isArray(value);
  const esObj = value !== null && typeof value === 'object' && !esArr;

  /* Array -> grupos/items listables. */
  if (esArr) {
    /* Array de primitivas -> lista de tags editables. */
    if (value.every((v) => v === null || typeof v !== 'object')) {
      return (
        <TagLista
          tags={(value as (string | number | boolean)[]).map(String)}
          onCambiar={(tags) => onChange(tags.map((t) => (t === 'true' ? true : t === 'false' ? false : t)))}
          etiqueta={etiqueta}
          profundo={profundo}
        />
      );
    }
    /* Array de objetos -> lista de tarjetas editables con agregar/quitar. */
    return (
      <ListaObjetos
        items={value}
        onChange={(items) => onChange(items)}
        etiqueta={etiqueta}
        profundo={profundo}
      />
    );
  }

  /* Objeto -> tarjeta de grupo con una fila por clave. */
  if (esObj) {
    const obj = value as { [k: string]: JsonValue };
    const claves = Object.keys(obj).sort();
    return (
      <Grupo titulo={etiqueta ?? 'configuración'} conteo={claves.length}>
        {claves.length === 0 && <div className="fjVacio">sin opciones</div>}
        {claves.map((k) => {
          const v = obj[k];
          const vEsArr = Array.isArray(v);
          const vEsObj = v !== null && typeof v === 'object' && !vEsArr;
          /* Anidados se renderizan como su propio grupo/lista. */
          if (vEsArr || vEsObj) {
            return (
              <EditorJson
                key={k}
                value={v}
                onChange={(nv) => onChange({ ...obj, [k]: nv })}
                etiqueta={k}
                profundo={profundo + 1}
              />
            );
          }
          return (
            <CampoLinea key={k} etiqueta={k}>
              <ControlPrimitiva value={v} onChange={(nv) => onChange({ ...obj, [k]: nv })} />
            </CampoLinea>
          );
        })}
      </Grupo>
    );
  }

  /* Primitiva suelta (raiz no objetual) */
  return <ControlPrimitiva value={value} onChange={onChange} />;
}

/* Control para un valor simple. */
function ControlPrimitiva({
  value,
  onChange,
}: {
  value: JsonValue;
  onChange: (v: JsonValue) => void;
}) {
  if (value === null) {
    return <span className="fjVacio">—</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <button
        type="button"
        className={`fjToggle${value ? ' fjToggle--on' : ''}`}
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
        className="fjInput"
        value={String(value)}
        /* [por que] number input espera value numerico; String() evita el
         * conflicto y NaN se descarta. */
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
      className="fjInput"
      value={value as string}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* Lista de "tags" (values simples) con quitar x + agregar. */
function TagLista({
  tags,
  onCambiar,
  etiqueta,
  profundo,
}: {
  tags: string[];
  onCambiar: (tags: string[]) => void;
  etiqueta?: string;
  profundo: number;
}) {
  const [nuevo, setNuevo] = useState('');
  const titulo = etiqueta ?? 'lista';

  function agregar() {
    const txt = nuevo.trim();
    if (!txt) {
      toastInfo('escribe un valor');
      return;
    }
    onCambiar([...tags, txt]);
    setNuevo('');
  }

  return (
    <div className={`fjTags${profundo > 0 ? ' fjTags--anidado' : ''}`}>
      <header className="fjTagsCab">
        <span className="fjTagsTitulo">{titulo}</span>
        <span className="fjGrupoConteo">({tags.length})</span>
      </header>
      {tags.length === 0 ? (
        <div className="fjVacio">vacío</div>
      ) : (
        <div className="fjTagsLista">
          {tags.map((t, i) => (
            <span className="fjTag" key={`${t}-${i}`}>
              <input
                className="fjTagInput"
                value={t}
                onChange={(e) => onCambiar([...tags.slice(0, i), e.target.value, ...tags.slice(i + 1)])}
                aria-label={`valor ${i + 1}`}
              />
              <button
                type="button"
                className="fjTagQuitar"
                onClick={() => onCambiar(tags.filter((_, j) => j !== i))}
                title="quitar"
                aria-label="quitar"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="fjTagsAgregar">
        <input
          type="text"
          className="fjInput fjInput--tagNuevo"
          value={nuevo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') agregar();
          }}
          placeholder="agregar valor…"
        />
        <button type="button" className="fjBoton" onClick={agregar}>
          agregar
        </button>
      </div>
    </div>
  );
}

/* Lista de objetos: cada item es una tarjeta con sus claves, editable. */
function ListaObjetos({
  items,
  onChange,
  etiqueta,
  profundo,
}: {
  items: JsonValue[];
  onChange: (items: JsonValue[]) => void;
  etiqueta?: string;
  profundo: number;
}) {
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
    <div className="fjListaObj">
      <header className="fjTagsCab">
        {etiqueta && <span className="fjTagsTitulo">{etiqueta}</span>}
        <span className="fjGrupoConteo">({items.length})</span>
      </header>
      {items.length === 0 ? (
        <div className="fjVacio">vacío</div>
      ) : (
        items.map((item, i) => (
          <div className="fjListItem" key={i}>
            <div className="fjListItemCab">
              <span className="fjListItemIndex">#{i + 1}</span>
              <button
                type="button"
                className="fjTagQuitar"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                title="quitar item"
                aria-label="quitar item"
              >
                ×
              </button>
            </div>
            <EditorJson
              value={item}
              onChange={(nv) => onChange([...items.slice(0, i), nv, ...items.slice(i + 1)])}
              profundo={profundo + 1}
            />
          </div>
        ))
      )}
      <div className="fjTagsAgregar">
        <button type="button" className="fjBoton" onClick={() => onChange([...items, itemNuevo()])}>
          agregar item
        </button>
      </div>
    </div>
  );
}