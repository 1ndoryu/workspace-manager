/* Formulario JSON generico PLANO: aplane todo el valor en una lista de filas,
 * una fila por opción, sin secciones anidadas. Cada etiqueta es la ruta (p.ej.
 * `sentinel › config › portableBoundaries › dom › enabled`). [por que] El usuario
 * pidio que las opciones NO esten anidadas y que cada una este separada; las
 * versiones con secciones anidadas se veian raras y dejaban hueco. Sigue siendo
 * generico: ninguna clave/regla esta hardcodeada.
 *
 * Mapa de tipos -> control:
 *   boolean  -> switch
 *   string   -> input de texto
 *   number   -> input numerico
 *   null     -> etiqueta "—"
 *   string[] -> tags editables en una fila (su etiqueta es la ruta)
 *   objeto / array de objetos -> cada hoja se aplane en su propia fila,
 *                                con la ruta como etiqueta. */
import { useState } from 'react';
import { Button } from './Button.js';
import { toastInfo } from './toast.js';

export type JsonValue = boolean | number | string | null | JsonValue[] | { [k: string]: JsonValue };

interface Props {
  value: JsonValue;
  onChange: (v: JsonValue) => void;
}

type Campo =
  | { tipo: 'simple'; label: string; valor: JsonValue; onChange: (v: JsonValue) => void }
  | { tipo: 'tags'; label: string; valores: string[]; onChange: (v: string[]) => void };

export function EditorJson({ value, onChange }: Props) {
  const filas = aplanar('', value, onChange);
  if (filas.length === 0) {
    return <div className="fjVacio">sin opciones</div>;
  }
  return (
    <div className="fjPlano">
      {/* key estable: label = ruta jerárquica única del campo (objeto usa la
       * clave, array el índice 1-based => rutas sin colisión en JSON válido). */}
      {filas.map((c) => <Fila key={c.label} campo={c} />)}
    </div>
  );
}

/* Aplana recursivamente value en una lista de filas (una por opción). */
function aplanar(pref: string, val: JsonValue, set: (v: JsonValue) => void): Campo[] {
  const filas: Campo[] = [];
  const P = pref ? pref + ' › ' : '';

  /* Valor simple -> fila. */
  if (val === null || typeof val !== 'object') {
    filas.push({ tipo: 'simple', label: pref || '(valor)', valor: val, onChange: set });
    return filas;
  }

  /* Array: de primitivas -> fila de tags; de objetos -> aplane cada item. */
  if (Array.isArray(val)) {
    const todosPrimitivos = val.every((v) => v === null || typeof v !== 'object');
    if (todosPrimitivos) {
      filas.push({
        tipo: 'tags',
        label: pref || 'lista',
        valores: (val as (string | number | boolean | null)[]).map(String),
        onChange: (s) =>
          set(s.map((t) => (t === 'true' ? true : t === 'false' ? false : t))),
      });
      return filas;
    }
    val.forEach((item, i) => {
      const key = `${P}[${i + 1}]`;
      filas.push(...aplanar(key, item, (nv) => set(val.map((x, j) => (j === i ? nv : x)))));
    });
    return filas;
  }

  /* Objeto: aplane cada clave con su ruta. */
  const obj = val as { [k: string]: JsonValue };
  Object.keys(obj)
    .sort()
    .forEach((k) => {
      const key = P + k;
      const v = obj[k];
      filas.push(...aplanar(key, v, (nv) => set({ ...obj, [k]: nv })));
    });
  return filas;
}

/* Renderiza una fila de opción: etiqueta (ruta) arriba, control debajo. */
function Fila({ campo }: { campo: Campo }) {
  if (campo.tipo === 'tags') {
    return (
      <div className="fjFila">
        <span className="fjEtiqueta">{campo.label}</span>
        <span className="fjControl">
          <TagLista valores={campo.valores} onCambiar={campo.onChange} />
        </span>
      </div>
    );
  }
  return (
    <div className="fjFila">
      <span className="fjEtiqueta">{campo.label}</span>
      <span className="fjControl">
        <ControlSimple value={campo.valor} onChange={campo.onChange} />
      </span>
    </div>
  );
}

/* Control para un valor simple. */
function ControlSimple({ value, onChange }: { value: JsonValue; onChange: (v: JsonValue) => void }) {
  if (value === null) return <span className="fjVacio">—</span>;
  if (typeof value === 'boolean') {
    return (
      <Button className={`fjSwitch${value ? ' fjSwitch--on' : ''}`} onClick={() => onChange(!value)} aria-pressed={value}>
        <span className="fjSwitchPalo" />
      </Button>
    );
  }
  if (typeof value === 'number') {
    return (
      <input
        type="number"
        className="fjInput fjInput--num"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isNaN(n) ? value : n);
        }}
      />
    );
  }
  return <input type="text" className="fjInput" value={value as string} onChange={(e) => onChange(e.target.value)} />;
}

/* Tags editables para una lista de valores simples (una fila). */
function TagLista({ valores, onCambiar }: { valores: string[]; onCambiar: (v: string[]) => void }) {
  const [nuevo, setNuevo] = useState('');
  function agregar() {
    const txt = nuevo.trim();
    if (!txt) { toastInfo('escribe un valor'); return; }
    onCambiar([...valores, txt]);
    setNuevo('');
  }
  return (
    <div className="fjTags">
      {valores.length === 0 && <div className="fjVacio">vacío</div>}
      <div className="fjTagsLista">
        {valores.map((t, i) => (
          <span className="fjTag" key={`${t}-${i}`}>
            <input
              className="fjTagInput"
              value={t}
              onChange={(e) => onCambiar([...valores.slice(0, i), e.target.value, ...valores.slice(i + 1)])}
              aria-label={`valor ${i + 1}`}
            />
            <Button className="fjTagQuitar" onClick={() => onCambiar(valores.filter((_, j) => j !== i))} title="quitar" aria-label="quitar">×</Button>
          </span>
        ))}
      </div>
      <div className="fjAgregar">
        <input
          className="fjInput fjInput--nuevo"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && agregar()}
          placeholder="agregar valor…"
        />
        <Button className="fjBoton" onClick={agregar}>agregar</Button>
      </div>
    </div>
  );
}