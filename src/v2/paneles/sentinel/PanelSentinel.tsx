/* Panel central 'sentinel': un tab al lado de config con su misma estructura
 * de dos columnas — abajo/opciones estan los proyectos y el panel muestra
 * las opciones del proyecto abierto (badges + editores de gate).
 * [por que] El usuario pidio no reinventar: es la vista 'proyecto' movida
 * desde config/ a su propia pagina, con la lista de proyectos como menu.
 * La logica vive en usePanelSentinel.ts y la vista en VistaProyecto.tsx:
 * este archivo solo arma el menu lateral y delega el contenido. */
import { usePanelSentinel } from './usePanelSentinel.js';
import { VistaProyecto } from './VistaProyecto.js';
import '../paneles.css';

export function PanelSentinel() {
  const datos = usePanelSentinel();
  if (!datos) return null;
  const { claveVisor, proyectos, abrirProyecto } = datos;

  return (
    <div className="panelDocs" aria-label="Sentinel">
      {/* Menu lateral: proyectos a configurar. */}
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">proyectos</header>
          <div className="panelDocsEntradas">
            {proyectos.length === 0 && <div className="docsVacio">sin proyectos visibles</div>}
            {proyectos.map((p) => (
              <button
                key={p.clave}
                type="button"
                className={`docsFila${p.clave === claveVisor ? ' docsFila--activa' : ''}`}
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
        <VistaProyecto datos={datos} />
      </div>
    </div>
  );
}
