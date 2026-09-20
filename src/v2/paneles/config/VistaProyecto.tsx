/* Vista 'proyecto' del PanelConfig: badges de estado del gate + editores
 * JSON (dirigidos por esquema cuando hay, genericos si no).
 * [por que] Salio de PanelConfig.tsx para que el componente quede bajo el
 * limite-lineas (300): recibe el paquete `datos` del hook, sin logica propia. */
import { Button } from '../../ui/Button.js';
import { EditorJson } from '../../ui/EditorJson.js';
import { EditorEsquema } from '../../EditorEsquema.js';
import { ARCHIVO_A_TOOL, badgesDe, type DatosPanelConfig } from './usePanelConfig.js';

export function VistaProyecto({ datos }: { datos: DatosPanelConfig }) {
  const {
    claveVisor, gate, contenidos, setContenidos, editado, setEditado, parseErrores,
    cargandoGate, guardando, proyectoVisor, visorIgnorado,
    esquemas, reglasCatalogo, alternarIgnorado, guardar,
  } = datos;

  if (!claveVisor) {
    return <div className="docsVacio">elige un proyecto de la lista</div>;
  }

  if (cargandoGate) {
    return <div className="docsVacio">cargando gate…</div>;
  }

  return (
    <>
      <header className="docsVisorCabecera">
        <span className="docsVisorTitulo">{visorIgnorado ? `${claveVisor} (ignorado)` : claveVisor}</span>
        <Button
          className="excBoton"
          onClick={() => void alternarIgnorado(claveVisor, !visorIgnorado)}
        >
          {visorIgnorado ? 'dejar de ignorar' : 'ignorar'}
        </Button>
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
            const valor = (editado[a.nombre] ?? null) as import('../../ui/EditorJson.js').JsonValue;
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
  );
}
