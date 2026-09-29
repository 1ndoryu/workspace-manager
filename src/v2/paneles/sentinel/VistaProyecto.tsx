/* Vista de proyecto del PanelSentinel: badges de estado del gate + editores
 * JSON (dirigidos por esquema cuando hay, genericos si no).
 * [por que] MOVIDA desde config/ sin cambio: recibe el paquete `datos` del
 * hook, sin logica propia. */
import { Button } from '../../ui/form/Button.js';
import { EditorJson } from '../../ui/form/EditorJson.js';
import { EditorEsquema } from '../../EditorEsquema.js';
import { ARCHIVO_A_TOOL, badgesDe, type DatosPanelSentinel } from './usePanelSentinel.js';

export function VistaProyecto({ datos }: { datos: DatosPanelSentinel }) {
  const {
    claveVisor, gate, contenidos, setContenidos, editado, setEditado, editadoInicial, parseErrores, setParseErrores,
    cargandoGate, guardando, proyectoVisor,
    esquemas, esquemasFuente, reglasCatalogo, guardar,
  } = datos;

  /* H3: re-parseo en vivo del textarea de reparacion. [por que] Antes el
   * error solo se calculaba en la carga: se podia escribir sin saber si el
   * JSON ya era valido, y no habia forma de guardar. Al validar, la rama
   * normal (editor + guardar) aparece sola. */
  const reparsear = (nombre: string, texto: string) => {
    setContenidos((c) => ({ ...c, [nombre]: texto }));
    if (!texto.trim()) {
      setParseErrores((e) => {
        const n = { ...e };
        delete n[nombre];
        return n;
      });
      return;
    }
    try {
      const v = JSON.parse(texto) as unknown;
      setEditado((e) => ({ ...e, [nombre]: v }));
      setParseErrores((e) => {
        const n = { ...e };
        delete n[nombre];
        return n;
      });
    } catch (err) {
      setParseErrores((e) => ({ ...e, [nombre]: err instanceof Error ? err.message : 'JSON inválido' }));
    }
  };

  /* H4: sin cambios no se guarda. [por que] guardar normaliza (indent 2 sin
   * newline final) y reescribia bytes en todos los configs aunque el
   * contenido fuera identico. */
  const sinCambios = (nombre: string): boolean =>
    JSON.stringify(editado[nombre]) === JSON.stringify(editadoInicial[nombre]);

  if (!claveVisor) {
    return <div className="docsVacio">elige un proyecto de la lista</div>;
  }

  if (cargandoGate) {
    return <div className="docsVacio">cargando gate…</div>;
  }

  return (
    /* [299A-7] Sin cabecera propia: titulo y accion ignorar viven en la
     * Caja contenido de PanelSentinel (un solo titulo, un solo lugar). */
    <>

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
                    {/* [299A-7] Guardar canonico: Button pequeno (la
                     * primitiva prohibe botones ad-hoc en cabeceras). */}
                    <Button
                      pequeno
                      disabled
                      title="corrige el JSON para poder guardar"
                    >
                      guardar
                    </Button>
                  </header>
                  <div className="ejError">JSON inválido: {parseErrores[a.nombre]}</div>
                  <textarea
                    className="panelDocsTexto gateEditorTexto"
                    value={contenidos[a.nombre] ?? ''}
                    onChange={(ev) => reparsear(a.nombre, ev.target.value)}
                    spellCheck={false}
                    aria-label={`Contenido de ${a.nombre} (inválido)`}
                  />
                  <div className="configMeta">edita hasta que el error desaparezca para guardar</div>
                </section>
              );
            }
            const tool = ARCHIVO_A_TOOL[a.nombre];
            const esquema = tool ? esquemas[tool] : undefined;
            /* H2: si el esquema es el estatico embebido (fallo la API), se
             * indica en vez de validar en silencio contra reglas viejas. */
            const fuenteEsquema = tool ? esquemasFuente[tool] : undefined;
            const valor = (editado[a.nombre] ?? null) as import('../../ui/form/EditorJson.js').JsonValue;
            const deshabilitado = guardando === a.nombre || sinCambios(a.nombre);
            return (
              <section key={a.nombre} className="gateEditor">
                <header className="gateEditorCabecera">
                  <span className="gateEditorNombre">{a.nombre}</span>
                  {fuenteEsquema === 'estatico' && (
                    <span
                      className="configBadge configBadge--sin"
                      title="no se pudo pedir el esquema vivo al server; se valida contra el estatico del bundle"
                    >
                      esquema local
                    </span>
                  )}
                  {/* [299A-7] Guardar canonico: Button pequeno. */}
                  <Button
                    pequeno
                    onClick={() => void guardar(a.nombre)}
                    disabled={deshabilitado}
                    title={sinCambios(a.nombre) ? 'sin cambios' : 'guardar cambios'}
                  >
                    {guardando === a.nombre ? 'guardando…' : 'guardar'}
                  </Button>
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
