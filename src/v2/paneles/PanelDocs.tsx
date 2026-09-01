/* Panel de documentacion: detecta las skills globales y gestiona los
 * AGENTS.md (de la raiz del area y de cada proyecto).
 * [por que] El usuario pidio un panel central para crear/manejar documentos:
 * las skills globales son esos documentos (SKILL.md en ~/.agents/skills) y
 * los agents.md de cada proyecto + el de la carpeta principal. Los datos de
 * deteccion vienen del snapshot; el contenido se lee/escribe por API.
 * [v2.2] Skills y AGENTS.md son una SOLA lista lateral con una etiqueta que
 * dice que es cada entrada; el contenido abre en el unico panel de la
 * derecha. */
import { usePanelDocs } from '../../hooks/usePanelDocs.js';
import './paneles.css';

export function PanelDocs() {
  const {
    snapshot,
    seleccion,
    contenido,
    cargando,
    guardando,
    skills,
    docs,
    grupos,
    setContenido,
    abrirSkill,
    abrirAgents,
    guardar,
  } = usePanelDocs();

  if (!snapshot) return null;

  const esSkill = seleccion?.tipo === 'skill';

  return (
    <div className="panelDocs" aria-label="Documentación">
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">
            documentación ({grupos.reduce((n, g) => n + g.entradas.length, 0)})
          </header>
          <div className="panelDocsEntradas">
            {grupos.length === 0 && <div className="docsVacio">no se detectaron documentos</div>}
            {grupos.map((grupo, i) => (
              <div key={grupo.titulo} className="docsGrupo">
                <div
                  className={`docsGrupoCabecera${i === 0 ? ' docsGrupoCabecera--primera' : ''}`}
                >
                  <span className="docsGrupoTitulo">{grupo.titulo}</span>
                  <span className="docsGrupoUbicacion">{grupo.ubicacion}</span>
                </div>
                {grupo.entradas.map((e) => {
                  const activa =
                    seleccion !== null && e.id === seleccion.id && e.etiqueta === (esSkill ? 'skill' : 'AGENTS.md');
                  return (
                    <button
                      key={`${e.etiqueta}:${e.id}`}
                      type="button"
                      className={`docsFila${activa ? ' docsFila--activa' : ''}`}
                      onClick={() => {
                        if (e.etiqueta === 'skill') {
                          const s = skills.find((x) => x.nombre === e.id);
                          if (s) void abrirSkill(s);
                        } else {
                          const d = docs.find((x) => x.id === e.id);
                          if (d) void abrirAgents(d);
                        }
                      }}
                      title={e.descripcion ?? e.nombre}
                    >
                      <span className="docsFilaEtiqueta">{e.etiqueta}</span>
                      <span className="docsFilaNombre">{e.nombre}</span>
                      {/* [por que] La descripcion larga de una skill estorba la
                       * lista y tapa el nombre; va al tooltip (title). En los
                       * AGENTS.md el meta corto (reglas/crear) si se muestra. */}
                      {e.etiqueta !== 'skill' && (
                        <span className="docsFilaMeta">
                          {e.tiene ? `${e.reglas} regla(s)` : 'crear'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="panelDocsContenido">
        {!seleccion && <div className="docsVacio">elige un documento para verlo/crearlo</div>}
        {seleccion && cargando && <div className="docsVacio">cargando…</div>}
        {seleccion && !cargando && contenido === null && (
          <div className="docsVacio">no se pudo cargar el documento</div>
        )}
        {seleccion && !cargando && contenido !== null && (
          <>
            <header className="panelDocsVisorCabecera">
              <span className="panelDocsVisorTitulo">{seleccion.nombre}</span>
              <button
                type="button"
                className="docsGuardar"
                onClick={() => void guardar()}
                disabled={guardando}
              >
                {guardando
                  ? 'guardando…'
                  : seleccion.tipo === 'agents'
                    ? seleccion.tiene
                      ? 'guardar'
                      : 'crear'
                    : 'guardar'}
              </button>
            </header>
            <textarea
              className="panelDocsTexto"
              value={contenido}
              onChange={(ev) => setContenido(ev.target.value)}
              spellCheck={false}
              aria-label={`Contenido de ${seleccion.nombre}`}
            />
          </>
        )}
      </div>
    </div>
  );
}
