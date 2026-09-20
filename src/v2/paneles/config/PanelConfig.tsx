/* Panel central 'config': configuracion por proyecto (ignorar + reglas de
 * sentinel/varsense) y gestion de excepciones (proyectos ignorados).
 * [por que] El usuario pidio que las excepciones no ocupen espacio en el
 * panel lateral: este es ahora un menu de opciones, y entre ellas esta
 * 'excepciones', que se abre en el contenido. Cada proyecto tambien es una
 * opcion que abre su configuracion en el contenido.
 * La logica vive en usePanelConfig.ts y cada vista en su Vista*.tsx: este
 * archivo solo arma el menu lateral y delega el contenido. */
import { usePanelConfig } from './usePanelConfig.js';
import { VistaExcepciones } from './VistaExcepciones.js';
import { VistaScan } from './VistaScan.js';
import { VistaGate } from './VistaGate.js';
import { VistaProyecto } from './VistaProyecto.js';
import '../paneles.css';

export function PanelConfig() {
  const datos = usePanelConfig();
  if (!datos) return null;
  const { vista, setVista, claveVisor, setClaveVisor, ignorados, proyectos, abrirProyecto } = datos;

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
            <button
              type="button"
              className={`docsFila${vista === 'scan' ? ' docsFila--activa' : ''}`}
              onClick={() => {
                setVista('scan');
                setClaveVisor(null);
              }}
            >
              <span className="docsFilaNombre">escaneo sentinel</span>
            </button>
            <button
              type="button"
              className={`docsFila${vista === 'gate' ? ' docsFila--activa' : ''}`}
              onClick={() => {
                setVista('gate');
                setClaveVisor(null);
              }}
            >
              <span className="docsFilaNombre">gate centralizado</span>
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
        {vista === 'excepciones' && <VistaExcepciones datos={datos} />}

        {/* Vista 'scan': config del auto-escaneo + boton 'Escanea todo'.
         * [por que] El usuario pidio que el escaneo tenga su propia opcion
         * de menu y no viva dentro de las excepciones. */}
        {vista === 'scan' && <VistaScan datos={datos} />}

        {vista === 'gate' && <VistaGate datos={datos} />}

        {vista === 'proyecto' && <VistaProyecto datos={datos} />}
      </div>
    </div>
  );
}
