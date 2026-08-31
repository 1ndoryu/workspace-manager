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
import { infoSegmento } from '../shared/gate/etiquetas.js';
import { REGLAS as REGLAS_ESTATICAS, type ReglaCatalogo } from '../shared/gate/reglas.js';
import { toastInfo } from './toast.js';

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

/* Seccion del catalogo de reglas (p.ej. `rules` de sentinel): TODAS las reglas
 * reales del runtime, organizadas en tabs por categoria (react, glory, php...).
 * Cada regla tiene switch (habilitada) y select de severidad; si no esta en el
 * JSON se muestra el default REAL del esquema (obtenido del nodo, no
 * hardcodeado) marcada como "por defecto", y al tocarla se inserta. Las reglas
 * presentes que no estan en el catalogo (las escribio el agente) tambien se
 * muestran, marcadas como desconocidas. [por que] El usuario pidio ver TODAS
 * las reglas (el runtime expone 105, no 14) y a la vez ordenarlas en tabs para
 * que sean navegables sin un listado interminable; la agrupacion sale del campo
 * `categoria` de cada regla (ReglasPorCategoria), no de una lista fija en la UI. */
function SeccionReglas({
  clave,
  item,
  reglas,
  valor,
  setEn,
  readOnly,
}: {
  clave: string;
  item: NodoEsquema;
  /* Catalogo inyectado (vivo del runtime o estatico). Fuente unica de
   * verdad para los ids, categorias, defaults de severidad/habilitada. */
  reglas: ReglaCatalogo[];
  valor: ValorJson | undefined;
  setEn: (r: Ruta, v: ValorJson) => void;
  readOnly?: boolean;
}) {
  /* Defaults REALES del esquema por regla (no hardcodeados). */
  const nodoHab = 'objeto' in item ? item.objeto['habilitada'] : undefined;
  const nodoSev = 'objeto' in item ? item.objeto['severidad'] : undefined;
  const defaultHabilitada = nodoHab && 'tipo' in nodoHab ? nodoHab.default !== false : true;
  const defaultSeveridad = nodoSev && 'tipo' in nodoSev && typeof nodoSev.default === 'string'
    ? nodoSev.default
    : 'error';
  const valoresSev =
    nodoSev && 'tipo' in nodoSev && nodoSev.tipo === 'enum' ? (nodoSev.valores ?? []) : [];

  const presente =
    valor !== null && typeof valor === 'object' && !Array.isArray(valor)
      ? (valor as Record<string, ValorJson>)
      : {};
  const ids = reglas.map((r) => r.id);
  const conoce = new Set(ids);
  const desconocidas = Object.keys(presente).filter((id) => !conoce.has(id)).sort();

  /* Agrupa por categoria desde el catalogo inyectado (data viva). Las
   * desconocidas (ids que escribio el agente y no estan en el catalogo) van en
   * su propio grupo al final, para no perderlas. */
  const porCategoria = new Map<string, ReglaCatalogo[]>();
  for (const r of reglas) {
    const arr = porCategoria.get(r.categoria) ?? [];
    arr.push(r);
    porCategoria.set(r.categoria, arr);
  }
  /* Preserva el orden natural del catalogo (primera aparicion), estable y
   * predecible. [por que] Reordenar por tamano o alfabetico cambiaria el orden
   * que el usuario ya conoce; el catalogo trae su orden. */
  const categorias: string[] = [];
  for (const r of reglas) if (!categorias.includes(r.categoria)) categorias.push(r.categoria);
  const [activa, setActiva] = useState<string>(categorias[0] ?? '');

  const enCatalogo = ids.filter((id) => Object.prototype.hasOwnProperty.call(presente, id)).length;
  const activas = [...ids, ...desconocidas].filter((id) => {
    const v = presente[id];
    const obj = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ValorJson>) : undefined;
    /* Reglas ausentes: heredan su default real por-regla (2 nacen apagadas). */
    const habCat = reglas.find((x) => x.id === id)?.habilitada;
    return obj ? obj['habilitada'] !== false : (habCat ?? defaultHabilitada);
  }).length;

  const idsDeCategoria = (cat: string): string[] =>
    (porCategoria.get(cat) ?? []).filter((r) => conoce.has(r.id)).map((r) => r.id);

  return (
    <section className="ejReglas">
      <header className="ejReglasCabecera">
        <span className="ejReglasTitulo">{infoSegmento(clave).nombre}</span>
        <span className="ejReglasMeta">
          {enCatalogo} de {ids.length} en config · {activas} activas
        </span>
      </header>
      <div className="ejTabs" role="tablist">
        {categorias.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={activa === c}
            className={`ejTab${activa === c ? ' ejTab--activo' : ''}`}
            onClick={() => setActiva(c)}
          >
            {categoriaNombre(c)} · {idsDeCategoria(c).length}
          </button>
        ))}
        {desconocidas.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={activa === '__desconocidas'}
            className={`ejTab${activa === '__desconocidas' ? ' ejTab--activo' : ''}`}
            onClick={() => setActiva('__desconocidas')}
          >
            Desconocidas · {desconocidas.length}
          </button>
        )}
      </div>
      <div className="ejReglasLista">
        {(activa === '__desconocidas' ? desconocidas : idsDeCategoria(activa)).map((id) => {
          const v = presente[id];
          const obj = v !== null && typeof v === 'object' && !Array.isArray(v)
            ? (v as Record<string, ValorJson>)
            : undefined;
          const ausente = obj === undefined;
          const desconocida = !conoce.has(id);
          /* Default real por regla del catalogo (habilitada/severidad). [por
           * que] No todas las reglas nacen activas: 2 de las 105 vienen
           * desactivadas por defecto (nomenclatura-css-ingles, default-export),
           * y cada una tiene su severidad propia. Solo las desconocidas caen al
           * default global del esquema. */
          const rCat = reglas.find((x) => x.id === id);
          const habilitada = obj ? obj['habilitada'] !== false : (rCat?.habilitada ?? defaultHabilitada);
          const severidad =
            obj && typeof obj['severidad'] === 'string'
              ? obj['severidad']
              : (rCat?.severidad ?? defaultSeveridad);

          const toggle = () => {
            if (readOnly) return;
            const nuevo = !habilitada;
            if (ausente) setEn([clave, id], { habilitada: nuevo, severidad });
            else setEn([clave, id, 'habilitada'], nuevo);
          };
          const cambiarSeveridad = (s: string) => {
            if (readOnly) return;
            if (ausente) setEn([clave, id], { habilitada, severidad: s });
            else setEn([clave, id, 'severidad'], s);
          };

          return (
            <div
              key={id}
              className={`ejRegla${ausente ? ' ejRegla--ausente' : ''}${desconocida ? ' ejRegla--desconocida' : ''}${!habilitada ? ' ejRegla--off' : ''}`}
            >
              <span className="ejReglaSwitch">
                {readOnly ? (
                  <span className="ejValorTexto">{habilitada ? 'sí' : 'no'}</span>
                ) : (
                  <button
                    type="button"
                    className={`fjSwitch${habilitada ? ' fjSwitch--on' : ''}`}
                    onClick={toggle}
                    aria-pressed={habilitada}
                    title={habilitada ? 'desactivar regla' : 'activar regla'}
                  >
                    <span className="fjSwitchPalo" />
                  </button>
                )}
              </span>
              <span className="ejReglaInfo">
                <EtiquetaDeRuta ruta={[clave, id]} texto={nombreRegla(id, reglas)} />
                <span className="ejReglaNotas">
                  {ausente && <span className="ejReglaPorDefecto">por defecto</span>}
                  {desconocida && <span className="ejMarcaTexto">desconocida</span>}
                </span>
              </span>
              <span className="ejReglaSev">
                {readOnly ? (
                  <span className="ejValorTexto">{severidad}</span>
                ) : (
                  <select
                    className="fjSelect"
                    value={severidad}
                    onChange={(e) => cambiarSeveridad(e.target.value)}
                    title="severidad de la regla"
                  >
                    {[...new Set([...valoresSev, severidad])].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* Nombre legible de una regla desde el catalogo (vivo o estatico). [por que]
 * El nombre de `etiquetas.ts` solo cubria las 14 reglas viejas; las 105 nuevas
 * usan el `nombre` del runtime 0.7.4. Fallback al id. */
function nombreRegla(id: string, reglas: ReglaCatalogo[]): string {
  const r = reglas.find((x) => x.id === id);
  return r ? r.nombre : infoSegmento(id).nombre;
}

/* Nombre legible de una categoria (traduccion corta). [por que] Los ids de
 * categoria son tecnicos (react-patrones, glory-schema...); se traducen para la
 * UI. Fallback al id tecnico si no hay. */
function categoriaNombre(c: string): string {
  const mapa: Record<string, string> = {
    'react-patrones': 'React',
    'glory-schema': 'Glory',
    'estructura-nomenclatura': 'Estructura',
    'wordpress-php': 'WordPress/PHP',
    'patrones-prohibidos': 'Prohibidos',
    'rust-patrones': 'Rust',
    'limites-archivo': 'Límites',
    'seguridad-sql': 'SQL',
  };
  return mapa[c] ?? c;
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
function EtiquetaDeRuta({ ruta, texto }: { ruta: Ruta; texto?: string }) {
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
      <span className="ejRutaNombre">{texto ?? rutaEtiqueta(ruta)}</span>
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