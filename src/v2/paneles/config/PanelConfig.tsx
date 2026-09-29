/* Panel central 'config': menu de opciones globales — excepciones
 * (proyectos ignorados), escaneo sentinel y gate centralizado.
 * [por que] La config por proyecto (badges + editores de gate) vive ahora en
 * el tab 'sentinel': misma estructura de dos columnas, solo movida.
 * La logica vive en usePanelConfig.ts y cada vista en su Vista*.tsx: este
 * archivo solo arma el menu lateral y delega el contenido.
 * [299A-7] Dos CAJAS externas (primitiva `Caja`) en `.cajaFila`: el menu
 * (titulo "opciones") y el contenido (titulo = la vista + accion verificar
 * en gate). Las cabeceras panelDocsVisor* no tenian estilo: eliminadas, el
 * titulo vive en la Caja. */
import { Button } from '../../ui/Button.js';
import { Caja } from '../../ui/Caja.js';
import { usePanelConfig } from './usePanelConfig.js';
import { VistaExcepciones } from './VistaExcepciones.js';
import { VistaScan } from './VistaScan.js';
import { VistaGate } from './VistaGate.js';
import '../paneles.css';
import './config.css';

const TITULO_VISTA = {
  excepciones: 'excepciones',
  scan: 'escaneo',
  gate: 'gate centralizado',
} as const;

export function PanelConfig() {
  const datos = usePanelConfig();
  if (!datos) return null;
  const { vista, setVista, ignorados, cargarSincronizacion } = datos;

  return (
    <div className="cajaFila">
      {/* Menu lateral de opciones globales. */}
      <Caja titulo="opciones" className="panelDocsLista" etiqueta="Opciones globales">
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
      </Caja>

      <Caja
        titulo={vista === 'excepciones' ? `excepciones (${ignorados.length})` : TITULO_VISTA[vista]}
        className="panelDocsContenido"
        etiqueta="Opción seleccionada"
        acciones={
          vista === 'gate' ? (
            <Button pequeno onClick={() => void cargarSincronizacion()}>
              verificar alineación
            </Button>
          ) : undefined
        }
      >
        {/* Vista por defecto: elige una opcion. */}
        {vista === 'excepciones' && <VistaExcepciones datos={datos} />}

        {/* Vista 'scan': config del auto-escaneo + boton 'Escaneado completo'.
         * [por que] El usuario pidio que el escaneo tenga su propia opcion
         * de menu y no viva dentro de las excepciones. */}
        {vista === 'scan' && <VistaScan datos={datos} />}

        {vista === 'gate' && <VistaGate datos={datos} />}
      </Caja>
    </div>
  );
}
