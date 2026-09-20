/* Vista 'excepciones' del PanelConfig: proyectos ignorados con boton quitar.
 * [por que] Salio de PanelConfig.tsx para que el componente quede bajo el
 * limite-lineas (300): recibe el paquete `datos` del hook, sin logica propia. */
import { Button } from '../../Button.js';
import type { DatosPanelConfig } from './usePanelConfig.js';

export function VistaExcepciones({ datos }: { datos: DatosPanelConfig }) {
  const { ignorados, alternarIgnorado } = datos;

  return (
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
              <Button
                className="excBoton"
                onClick={() => void alternarIgnorado(clave, false)}
                title="dejar de ignorar este proyecto"
              >
                quitar
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
