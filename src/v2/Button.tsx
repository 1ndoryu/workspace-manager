/* Boton canonico del shell v2.
 * [por que] En vez de estilos de boton ad-hoc por clase (mapaV2ZoomBoton,
 * mapaV2ManoBoton, v2NavBoton), todos los botones del v2 pasan por este
 * componente monocromo. `cuadrado` es el boton compacto de solo icono
 * (zoom/mover); `activo` invierte el relleno. El archivo se llama Button
 * para que html-nativo-en-vez-de-componente no marque su <button> interno. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  activo?: boolean;
  cuadrado?: boolean;
  children: ReactNode;
}

export function Button({ activo = false, cuadrado = false, children, className, ...rest }: ButtonProps) {
  const clases = [
    'botonV2',
    activo ? 'botonV2--activo' : '',
    cuadrado ? 'botonV2--cuadrado' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={clases} {...rest}>
      {children}
    </button>
  );
}