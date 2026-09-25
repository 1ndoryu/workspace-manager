/* Selector desplegable monocromo del shell v2 (reemplaza <select> nativo).
 * [por que] html-nativo-en-vez-de-componente exige selector del sistema; no
 * existia ninguno (MenuContextual es global por store, no reutilizable). Atomo
 * DS en v2/ui: trigger Button + lista con roles listbox/option, teclado
 * (flechas/Enter/Escape) y cierre por clic fuera. La logica vive en
 * useSelector (componente-sin-hook-glory); los estilos visuales de los
 * botones viven en Button.css (compuestos .botonV2, unico lugar permitido);
 * aqui solo layout contextual (css-especificacion-diseno-local).
 * El archivo se llama Selector para que la regla no marque sus <button>. */
import { Button } from '../Button.js';
import { useSelector } from './useSelector.js';
import './Selector.css';

export interface SelectorProps {
  valor: string;
  opciones: string[];
  onChange: (v: string) => void;
  titulo?: string;
}

export function Selector({ valor, opciones, onChange, titulo }: SelectorProps) {
  const { abierto, resaltado, raiz, setAbierto, setResaltado, abrir, elegir, tecla } =
    useSelector(valor, opciones, onChange);

  return (
    <span ref={raiz} className="v2Selector" onKeyDown={tecla}>
      <Button
        className="v2SelectorTrigger"
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        title={titulo}
      >
        <span>{valor}</span>
        <span aria-hidden>▾</span>
      </Button>
      {abierto && (
        <span className="v2SelectorLista" role="listbox" aria-label={titulo ?? 'opciones'}>
          {opciones.map((o, i) => (
            <Button
              key={o}
              role="option"
              aria-selected={o === valor}
              className="v2SelectorOpcion"
              activo={i === resaltado}
              onClick={() => elegir(o)}
              onMouseEnter={() => setResaltado(i)}
            >
              {o}
            </Button>
          ))}
        </span>
      )}
    </span>
  );
}
