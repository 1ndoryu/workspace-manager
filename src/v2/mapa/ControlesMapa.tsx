/* Controles del mapa (esquina superior derecha): zoom. El arrastre esta siempre activo: se
 * agarra el mapa y se mueve, sin boton de por medio. */
import { Button } from '../ui/form/Button.js';

interface Props {
  acercar: () => void;
  alejar: () => void;
}

export function ControlesMapa({ acercar, alejar }: Props) {
  return (
    <div className="mapaV2Controles">
      <Button cuadrado grande onClick={acercar} aria-label="Acercar" title="Acercar">
        +
      </Button>
      <Button cuadrado grande onClick={alejar} aria-label="Alejar" title="Alejar">
        −
      </Button>
    </div>
  );
}
