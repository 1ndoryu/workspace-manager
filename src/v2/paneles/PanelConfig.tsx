/* Panel central 'config': configuracion por proyecto (ignorar + reglas de
 * sentinel/varsense) y gestion de excepciones (proyectos ignorados).
 * [por que] El usuario pidio que las excepciones no ocupen espacio en el
 * panel lateral: este es ahora un menu de opciones, y entre ellas esta
 * 'excepciones', que se abre en el contenido. Cada proyecto tambien es una
 * opcion que abre su configuracion en el contenido. */
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import type { EstadoGate } from '../../shared/types.js';
import { mensajeDeError, toastError, toastOk } from '../toast.js';
import { EditorJson } from '../EditorJson.js';
import { EditorEsquema } from '../EditorEsquema.js';
import type { NodoEsquema } from '../../shared/gate/esquema.js';
import type { TipoGate } from '../../shared/gate/proveedores.js';
import './paneles.css';

/* Archivos de gate editables (whitelist del server: same list). */
const ARCHIVOS = ['sentinel.config.json', 'sentinel.lock.json', 'quality-tools.json', 'varsense.config.json'] as const;

/* Que archivo se edita por ESQUEMA (dirigido por esquema) y cual cae al
 * EditorJson generico. Mapea el archivo a su HERRAMIENTA del gate; el esquema
 * se carga por la API /gate/dinamico (el server lo resuelve) y el cliente es
 * 'tonto'. [por que] E1 gate-dinamico: el bundle deja de importar los ESQUEMA_*
 * estaticos; sentinel.config.json usa el esquema del server (curado contra su
 * runtime) y varsense.config.json el curado de los configs reales. lock y
 * quality-tools no tienen fuente canonica fiable -> EditorJson generico. */
const ARCHIVO_A_TOOL: Partial<Record<(typeof ARCHIVOS)[number], TipoGate>> = {
  'sentinel.config.json': 'sentinel',
  'varsense.config.json': 'varsense',
};

/* Vista del visor derecho: la lista de excepciones o la config de un proyecto. */
type Vista = 'excepciones' | 'proyecto';

interface GateRespuesta {
  clave: string;
  estado: EstadoGate | null;
  archivos: { nombre: (typeof ARCHIVOS)[number]; existe: boolean }[];
  contenidos: Partial<Record<(typeof ARCHIVOS)[number], string | null>>;
}

/* Formatea el estado del gate en etiquetas legibles. */
function badgesDe(estado: EstadoGate | null): { texto: string; clave: string }[] {
  if (!estado) return [{ texto: 'gate: no', clave: 'badge--sin' }];
  const b: { texto: string; clave: string }[] = [];
  b.push({ texto: `gate: ${estado.declarado ? 'sí' : 'no'}`, clave: estado.declarado ? 'badge' : 'badge--sin' });
  b.push({ texto: `sentinel: ${estado.sentinel}`, clave: estado.sentinel === 'none' ? 'badge--sin' : 'badge' });
  b.push({ texto: `varsense: ${estado.varsense ? 'sí' : 'no'}`, clave: estado.varsense ? 'badge' : 'badge--sin' });
  b.push({ texto: `puerta: ${estado.puerta}`, clave: estado.puerta === 'none' ? 'badge--sin' : 'badge' });
  return b;
}

export function PanelConfig() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargar = useWorkspaceStore((s) => s.cargar);
  const proyectoAConfigurar = useWorkspaceStore((s) => s.proyectoAConfigurar);
  const cambiarIgnorado = useWorkspaceStore((s) => s.cambiarIgnorado);
  /* Catalogo de reglas vivo del gate (el server lo resuelve del runtime);
   * el store lo pide una vez y cae al estatico si falla. [por que] R1
   * gate-dinamico: el editor debe usar las reglas reales del runtime, no el
   * snapshot congelado del bundle. */
  const reglasCatalogo = useWorkspaceStore((s) => s.reglasCatalogo);
  const cargarReglas = useWorkspaceStore((s) => s.cargarReglas);
  const cargarEsquema = useWorkspaceStore((s) => s.cargarEsquema);

  /* Esquemas por herramienta ya rehidratados desde la API (cache local a la
   * vista; el store cachea a nivel global). */
  const [esquemas, setEsquemas] = useState<Partial<Record<TipoGate, NodoEsquema>>>({});

  /* Al montar el panel, se asegura de que el catalogo de reglas este cargado
   * (fetch una vez; si ya esta, no repite). */
  useEffect(() => {
    void cargarReglas();
  }, [cargarReglas]);

  /* Vista actual y, si es 'proyecto', la clave del proyecto abierto. */
  const [vista, setVista] = useState<Vista>('excepciones');
  const [claveVisor, setClaveVisor] = useState<string | null>(null);
  const [gate, setGate] = useState<GateRespuesta | null>(null);
  const [contenidos, setContenidos] = useState<Record<string, string>>({});
  /* Valores editados por el EditorJson (parsed por archivo). */
  const [editado, setEditado] = useState<Record<string, unknown>>({});
  /* Errores de parseo si el JSON de un archivo no es valido. */
  const [parseErrores, setParseErrores] = useState<Record<string, string>>({});
  const [cargandoGate, setCargandoGate] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);

  /* [por que] El menu contextual abre la pagina 'config' con un proyecto
   * determinado: inicial/a cada cambio, si llega un proyecto, se muestra su
   * configuracion (vista proyecto) en vez de las excepciones. */
  useEffect(() => {
    if (proyectoAConfigurar) {
      setClaveVisor(proyectoAConfigurar);
      setVista('proyecto');
    }
  }, [proyectoAConfigurar]);

  /* Carga el gate del proyecto abierto cada vez que cambia la clave. */
  useEffect(() => {
    if (vista !== 'proyecto' || !claveVisor) {
      setGate(null);
      return;
    }
    let viva = true;
    setCargandoGate(true);
    axios
      .get<GateRespuesta>(`/api/proyecto/gate?clave=${encodeURIComponent(claveVisor)}`)
      .then(({ data }) => {
        if (!viva) return;
        setGate(data);
        /* Pre-carga el contenido de cada archivo existente en el editor ya
         * parseado como JSON (el EditorJson trabaja sobre el valor, no el texto). */
        const inicial: Record<string, string> = {};
        for (const a of ARCHIVOS) {
          const c = data.contenidos[a];
          if (typeof c === 'string') inicial[a] = c;
        }
        setContenidos(inicial);
        setParseErrores({});
        /* Parseo cada archivo valido a su valor JSON para el EditorJson. */
        const pars: Record<string, unknown> = {};
        const errs: Record<string, string> = {};
        for (const a of ARCHIVOS) {
          const c = data.contenidos[a];
          if (typeof c !== 'string' || !c.trim()) continue;
          try {
            /* Cast controlado: JSON.parse devuelve cualquier valor; EditorJson
         * espera un JsonValue, que sanitizamos recursivamente al renderizar. */
        pars[a] = JSON.parse(c) as unknown;
          } catch (e) {
            errs[a] = e instanceof Error ? e.message : 'JSON inválido';
          }
        }
        setEditado(pars);
        setParseErrores(errs);
      })
      .catch((err) => {
        if (!viva) return;
        toastError(`no se pudo leer el gate: ${mensajeDeError(err)}`);
        setGate(null);
      })
      .finally(() => {
        if (viva) setCargandoGate(false);
      });
    return () => {
      viva = false;
    };
  }, [vista, claveVisor]);

  /* Carga por API el esquema de las herramientas cuyo archivo declara el
   * proyecto abierto. [por que] El esquema se sirve serializado por
   * /gate/dinamico y se rehidrata; el store lo cachea para no repetir el fetch
   * por cada proyecto. (E1 gate-dinamico: el bundle deja de importar ESQUEMA_*.) */
  useEffect(() => {
    if (vista !== 'proyecto' || !gate) return;
    let viva = true;
    for (const a of gate.archivos) {
      const tool = ARCHIVO_A_TOOL[a.nombre];
      if (!tool || esquemas[tool]) continue;
      void cargarEsquema(tool).then((nodo) => {
        if (viva && nodo) setEsquemas((e) => ({ ...e, [tool]: nodo }));
      });
    }
    return () => {
      viva = false;
    };
  }, [vista, gate, esquemas, cargarEsquema]);

  if (!snapshot) return null;

  const ignorados = snapshot.config.ignorados;
  const proyectos = snapshot.proyectos;
  const proyectoVisor = proyectos.find((p) => p.clave === claveVisor);
  const visorIgnorado = claveVisor !== null && ignorados.includes(claveVisor);

  async function alternarIgnorado(clave: string, ignorar: boolean) {
    try {
      await cambiarIgnorado(clave, ignorar);
      toastOk(ignorar ? 'ignorado ✓' : 'ya no se ignora ✓');
    } catch (err) {
      toastError(mensajeDeError(err));
    }
  }

  /* Guarda el JSON editado de un archivo de gate del proyecto del visor. */
  async function guardar(a: string) {
    if (!claveVisor) return;
    setGuardando(a);
    try {
      /* Serializa el valor editado (indent 2) y lo envia; el server valida
       * JSON de nuevo antes de escribir. */
      const contenido = JSON.stringify(editado[a] ?? null, null, 2);
      await axios.post(
        `/api/proyecto/gate?clave=${encodeURIComponent(claveVisor)}`,
        { nombre: a, contenido },
      );
      toastOk(`${a} guardado ✓`);
      await cargar(true);
    } catch (err) {
      toastError(`no se pudo guardar: ${mensajeDeError(err)}`);
    } finally {
      setGuardando(null);
    }
  }

  /* Guarda la clave y pasa a la vista de un proyecto concreto. */
  function abrirProyecto(clave: string) {
    setClaveVisor(clave);
    setVista('proyecto');
  }

  return (
    <div className="panelDocs" aria-label="Configuración">
      {/* Menu lateral de opciones: excepciones + proyectos a configurar. */}
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">opciones</header>
          <div className="panelDocsEntradas">
            <button
              type="button"
              className={`docsFila${vista === 'excepciones' ? ' docsFila--activa' : ''}`}
              onClick={() => {
                setVista('excepciones');
                setClaveVisor(null);
              }}
            >
              <span className="docsFilaNombre">excepciones ({ignorados.length})</span>
            </button>
          </div>
        </section>
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">configurar proyecto</header>
          <div className="panelDocsEntradas">
            {proyectos.length === 0 && <div className="docsVacio">sin proyectos visibles</div>}
            {proyectos.map((p) => (
              <button
                key={p.clave}
                type="button"
                className={`docsFila${
                  vista === 'proyecto' && p.clave === claveVisor ? ' docsFila--activa' : ''
                }`}
                onClick={() => abrirProyecto(p.clave)}
                title={p.ruta}
              >
                <span className="docsFilaNombre">{p.clave}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="panelDocsContenido">
        {/* Vista por defecto: elige una opcion. */}
        {vista === 'excepciones' && (
          <>
            <header className="panelDocsVisorCabecera">
              <span className="panelDocsVisorTitulo">excepciones ({ignorados.length})</span>
            </header>
            {ignorados.length === 0 ? (
              <div className="docsVacio">
                no hay excepciones guardadas. usa el menú contextual (clic derecho) sobre un proyecto
                para ignorarlo
              </div>
            ) : (
              <div className="excListaContenido">
                {/* [por que] Cada excepcion es una fila tipo lista: quitar la
                 * vuelve a ser un proyecto visible al instante. */}
                {ignorados.map((clave) => (
                  <div key={clave} className="excFila">
                    <span className="excFilaNombre">{clave}</span>
                    <button
                      type="button"
                      className="excBoton"
                      onClick={() => void alternarIgnorado(clave, false)}
                      title="dejar de ignorar este proyecto"
                    >
                      quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {vista === 'proyecto' && !claveVisor && (
          <div className="docsVacio">elige un proyecto de la lista</div>
        )}

        {vista === 'proyecto' && claveVisor && cargandoGate && <div className="docsVacio">cargando gate…</div>}

        {vista === 'proyecto' && claveVisor && !cargandoGate && (
          <>
            <header className="docsVisorCabecera">
              <span className="docsVisorTitulo">{visorIgnorado ? `${claveVisor} (ignorado)` : claveVisor}</span>
              <button
                type="button"
                className="excBoton"
                onClick={() => void alternarIgnorado(claveVisor, !visorIgnorado)}
              >
                {visorIgnorado ? 'dejar de ignorar' : 'ignorar'}
              </button>
            </header>

            {proyectoVisor && <div className="configMeta">{proyectoVisor.ruta}</div>}

            {/* Estado del gate en badges. */}
            <div className="configBadges">
              {badgesDe(gate?.estado ?? null).map((b) => (
                <span key={b.texto} className={`configBadge ${b.clave}`}>
                  {b.texto}
                </span>
              ))}
            </div>

            {!gate || gate.archivos.length === 0 ? (
              <div className="docsVacio">este proyecto no declara archivos de gate (sentinel/varsense)</div>
            ) : (
              <div className="gateEditores">
                {gate.archivos.map((a) => {
                  /* Si el archivo no es JSON valido, mostramos el error en vez
                   * del editor (para no corromper el archivo sin querer). */
                  if (parseErrores[a.nombre]) {
                    return (
                      <section key={a.nombre} className="gateEditor">
                        <header className="gateEditorCabecera">
                          <span className="gateEditorNombre">{a.nombre}</span>
                        </header>
                        <div className="ejError">JSON inválido: {parseErrores[a.nombre]}</div>
                        <textarea
                          className="panelDocsTexto gateEditorTexto"
                          value={contenidos[a.nombre] ?? ''}
                          onChange={(ev) =>
                            setContenidos((c) => ({ ...c, [a.nombre]: ev.target.value }))
                          }
                          spellCheck={false}
                          aria-label={`Contenido de ${a.nombre} (inválido)`}
                        />
                      </section>
                    );
                  }
                  const tool = ARCHIVO_A_TOOL[a.nombre];
                  const esquema = tool ? esquemas[tool] : undefined;
                  const valor = (editado[a.nombre] ?? null) as import('../EditorJson.js').JsonValue;
                  return (
                    <section key={a.nombre} className="gateEditor">
                      <header className="gateEditorCabecera">
                        <span className="gateEditorNombre">{a.nombre}</span>
                        <button
                          type="button"
                          className="docsGuardar"
                          onClick={() => void guardar(a.nombre)}
                          disabled={guardando === a.nombre}
                        >
                          {guardando === a.nombre ? 'guardando…' : 'guardar'}
                        </button>
                      </header>
                      {esquema ? (
                        <EditorEsquema
                          key={`${claveVisor}:${a.nombre}`}
                          esquema={esquema}
                          value={valor}
                          reglas={reglasCatalogo.reglas}
                          onChange={(nv) => setEditado((e) => ({ ...e, [a.nombre]: nv }))}
                        />
                      ) : (
                        <EditorJson
                          key={`${claveVisor}:${a.nombre}`}
                          value={valor}
                          onChange={(nv) => setEditado((e) => ({ ...e, [a.nombre]: nv }))}
                        />
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}