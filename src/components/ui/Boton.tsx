/* Componente atomico: Boton.
 * [por que] Variante unica (boton base) + secundario/enlace, sin estilos ad-hoc. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './boton.css';

export type VarianteBoton = 'primario' | 'secundario' | 'enlace';

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  children: ReactNode;
}

export function Boton({ variante = 'primario', children, className, ...rest }: BotonProps) {
  return (
    <button className={`boton boton--${variante} ${className ?? ''}`} {...rest}>
      {children}
    </button>
  );
}
