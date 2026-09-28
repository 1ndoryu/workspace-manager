/* Casilla canonica del shell v2 (checkbox monocromo).
 * [por que] El checkbox nativo se pinta con el color de acento del
 * navegador (naranja en la captura del panel pc) y rompe el monocromo
 * estricto del v2. Casilla conserva el input real (teclado, lector,
 * foco) invisible y dibuja la caja solo con tokens --v2-*: borde fino,
 * marcado por inversion de relleno (mismo patron que botonV2--activo),
 * indeterminado con barra. Sin radios, sin sombras, sin color. */
import { useEffect, useRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import './Casilla.css';

export interface CasillaProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  indeterminado?: boolean;
}

export function Casilla({ indeterminado = false, className, ...rest }: CasillaProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminado;
  }, [indeterminado]);
  return (
    <span className={['casillaV2', className ?? ''].filter(Boolean).join(' ')}>
      <input ref={ref} type="checkbox" className="casillaV2Entrada" {...rest} />
      <span className="casillaV2Caja" aria-hidden="true" />
    </span>
  );
}
