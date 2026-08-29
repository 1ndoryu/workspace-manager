/* Panel central 'config': gestion de excepciones (proyectos ignorados) y
 * configuracion por proyecto (ignorar + reglas de sentinel/varsense).
 * [por que] El usuario pidio una pagina para gestionar las excepciones
 * guardadas (p. ej. 3D/01 no es un proyecto) y configuracion avanzada por
 * proyecto: ver su gate y controlar sus reglas editando el JSON real. */
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import type { EstadoGate } from '../../shared/types.js';
import { mensajeDeError, toastError, toastOk } from '../toast.js';
import './paneles.css';

/* Archivos de gate editables (whitelist del server: same list). */
const ARCHIVOS = ['sentinel.config.json', 'sentinel.lock.json', 'quality-tools.json', 'varsense.config.json'] as const;

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

  /* Proyecto abierto en el visor derecho (por clave). */
  const [claveVisor, setClaveVisor] = useState<string | null>(null);
  const [gate, setGate] = useState<GateRespuesta | null>(null);
  const [contenidos, setContenidos] = useState<Record<string, string>>({});
  const [cargandoGate, setCargandoGate] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);

  /* [por que] Al inicial y cada vez que cambie el snapshot (tras ignorar /
   * re-escaneo), el visor apunta al proyecto que pidio el menu contextual. */
  useEffect(() => {
    if (proyectoAConfigurar) setClaveVisor(proyectoAConfigurar);
  }, [proyectoAConfigurar]);

  /* Carga el gate del proyecto abierto cada vez que cambia la clave. */
  useEffect(() => {
    if (!claveVisor) {
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
        /* Pre-carga el contenido de cada archivo existente en el editor. */
        const inicial: Record<string, string> = {};
        for (const a of ARCHIVOS) {
          const c = data.contenidos[a];
          if (typeof c === 'string') inicial[a] = c;
        }
        setContenidos(inicial);
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
  }, [claveVisor]);

  if (!snapshot) return null;

  const ignorados = snapshot.config.ignorados;
  const proyectoVisor = snapshot.proyectos.find((p) => p.clave === claveVisor);
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
  async function guardar(a: string, contenido: string) {
    if (!claveVisor) return;
    setGuardando(a);
    try {
      await axios.post(
        `/api/proyecto/gate?clave=${encodeURIComponent(claveVisor)}`,
        { nombre: a, contenido },
      );
      toastOk(`${a} guardado ✓`);
      /* Re-escanea para que el estado del gate refleje el guardado. */
      await cargar(true);
    } catch (err) {
      toastError(`no se pudo guardar: ${mensajeDeError(err)}`);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="panelDocs" aria-label="Configuración">
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">excepciones ({ignorados.length})</header>
          <div className="panelDocsEntradas">
            {ignorados.length === 0 && <div className="docsVacio">no hay excepciones guardadas</div>}
            {ignorados.map((clave) => (
              <div key={clave} className="excFila">
                <button
                  type="button"
                  className="excFilaNombre"
                  onClick={() => setClaveVisor(clave)}
                  title="configurar esta excepción"
                >
                  {clave}
                </button>
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
        </section>
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">configurar proyecto</header>
          <div className="panelDocsEntradas">
            {snapshot.proyectos.length === 0 && <div className="docsVacio">sin proyectos visibles</div>}
            {snapshot.proyectos.map((p) => (
              <button
                key={p.clave}
                type="button"
                className={`docsFila${p.clave === claveVisor ? ' docsFila--activa' : ''}`}
                onClick={() => setClaveVisor(p.clave)}
                title={p.ruta}
              >
                <span className="docsFilaNombre">{p.clave}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="panelDocsContenido">
        {!claveVisor && (
          <div className="docsVacio">
            elige un proyecto (menú contextual o lista) para configurarlo, o gestiona las excepciones
          </div>
        )}

        {claveVisor && cargandoGate && <div className="docsVacio">cargando gate…</div>}

        {claveVisor && !cargandoGate && (
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

            {proyectoVisor && (
              <div className="configMeta">{proyectoVisor.ruta}</div>
            )}

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
                  const contenido = contenidos[a.nombre] ?? '';
                  return (
                    <section key={a.nombre} className="gateEditor">
                      <header className="gateEditorCabecera">
                        <span className="gateEditorNombre">{a.nombre}</span>
                        <button
                          type="button"
                          className="docsGuardar"
                          onClick={() => void guardar(a.nombre, contenido)}
                          disabled={guardando === a.nombre}
                        >
                          {guardando === a.nombre ? 'guardando…' : 'guardar'}
                        </button>
                      </header>
                      <textarea
                        className="panelDocsTexto gateEditorTexto"
                        value={contenido}
                        onChange={(ev) =>
                          setContenidos((c) => ({ ...c, [a.nombre]: ev.target.value }))
                        }
                        spellCheck={false}
                        aria-label={`Contenido de ${a.nombre}`}
                      />
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