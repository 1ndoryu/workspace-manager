/* Controles del mapa (esquina superior derecha): modo mover (mano) y zoom. */
import { Button } from '../ui/form/Button.js';

interface Props {
  modoArrastre: boolean;
  alternarModoArrastre: () => void;
  acercar: () => void;
  alejar: () => void;
}

export function ControlesMapa({ modoArrastre, alternarModoArrastre, acercar, alejar }: Props) {
  return (
    <div className="mapaV2Controles">
      <Button
        cuadrado
        activo={modoArrastre}
        onClick={alternarModoArrastre}
        aria-label="Mover el mapa (arrastrar)"
        aria-pressed={modoArrastre}
        title={modoArrastre ? 'Modo mover activo: arrastra el mapa' : 'Activar modo mover: arrastra el mapa'}
      >
        {/* Icono de mano (pan_tool de Material) en monocromo: fill=currentColor
         * hereda el color del boton segun su estado. */}
        <svg className="mapaV2ManoIcono" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M23,5.5V20c0,2.2 -1.8,4 -4,4h-7.3c-1.08,0 -2.1,-0.43 -2.85,-1.19L1,14.83c0,0 -1.26,-1.38 0.3,-2.24c0.39,-0.23 0.86,-0.26 1.27,-0.03L6,15V4c0,-1.1 0.9,-2 2,-2s2,0.9 2,2v6h1V1.5c0,-0.83 0.67,-1.5 1.5,-1.5S14,0.67 14,1.5V10h1V2.5c0,-0.83 0.67,-1.5 1.5,-1.5S18,1.67 18,2.5V10h1V5.5c0,-0.83 0.67,-1.5 1.5,-1.5S22,4.67 22,5.5z"
            fill="currentColor"
          />
        </svg>
      </Button>
      <Button cuadrado grande onClick={acercar} aria-label="Acercar" title="Acercar">
        +
      </Button>
      <Button cuadrado grande onClick={alejar} aria-label="Alejar" title="Alejar">
        −
      </Button>
    </div>
  );
}
