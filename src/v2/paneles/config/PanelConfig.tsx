/* Panel central 'config': menu de opciones globales — excepciones
 * (proyectos ignorados), escaneo sentinel y gate centralizado.
 * [por que] La config por proyecto (badges + editores de gate) vive ahora en
 * el tab 'sentinel': misma estructura de dos columnas, solo movida.
 * La logica vive en usePanelConfig.ts y cada vista en su Vista*.tsx: este
 * archivo solo arma el menu lateral y delega el contenido. */
import { usePanelConfig } from './usePanelConfig.js';
import { VistaExcepciones } from './VistaExcepciones.js';
import { VistaScan } from './VistaScan.js';
import { VistaGate } from './VistaGate.js';
import '../paneles.css';
import './config.css';

export function PanelConfig() {
  const datos = usePanelConfig();
  if (!datos) return null;
  const { vista, setVista, ignorados } = datos;

  return (
    <div className="panelDocs" aria-label="Configuración">
      {/* Menu lateral de opciones globales. */}
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">opciones</header>
          <div className="panelDocsEntradas">
            <button
              type="button"
              className={`docsFila${vista === 'excepciones' ? ' docsFila--activa' : ''}`}
              onClick={() => setVista('excepciones')}
            >
              <span className="docsFilaNombre">excepciones ({ignorados.length})</span>
            </button>
            <button
              type="button"
              className={`docsFila${vista === 'scan' ? ' docsFila--activa' : ''}`}
              onClick={() => setVista('scan')}
            >
              <span className="docsFilaNombre">escaneo sentinel</span>
            </button>
            <button
              type="button"
              className={`docsFila${vista === 'gate' ? ' docsFila--activa' : ''}`}
              onClick={() => setVista('gate')}
            >
              <span className="docsFilaNombre">gate centralizado</span>
            </button>
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
      </div>
    </div>
  );
}
