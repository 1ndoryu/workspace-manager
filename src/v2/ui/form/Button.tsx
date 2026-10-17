/* Boton canonico del shell v2.
 * [por que] En vez de estilos de boton ad-hoc por clase (mapaV2ZoomBoton,
 * mapaV2ManoBoton, v2NavBoton), todos los botones del v2 pasan por este
 * componente monocromo. `cuadrado` es el boton compacto de solo icono
 * (zoom/mover); `pequeno` es compacto de 20px de alto para filas densas
 * (solo o con cuadrado); `activo` invierte el relleno. El archivo se llama Button
 * para que html-nativo-en-vez-de-componente no marque su <button> interno. */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  activo?: boolean;
  cuadrado?: boolean;
  grande?: boolean;
  pequeno?: boolean;
  /* Opcional: un boton sin contenido es legitimo cuando es solo superficie
   * pulsable (el fondo del menu contextual, que cubre la pantalla para cerrar).
   * Exigirlo obligaba a esos sitios a quedarse en <button> nativo. */
  children?: ReactNode;
}

/* [por que] `forwardRef`: los menus con teclado necesitan mover el foco entre
 * sus opciones, y sin ref no habia forma de alcanzar el <button> de dentro
 * (React 18 no pasa `ref` por las props). No cambia nada para quien no la use. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { activo = false, cuadrado = false, grande = false, pequeno = false, children, className, ...rest },
  ref,
) {
  const clases = [
    'botonV2',
    activo ? 'botonV2--activo' : '',
    cuadrado ? 'botonV2--cuadrado' : '',
    grande ? 'botonV2--grande' : '',
    pequeno ? 'botonV2--pequeno' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type="button" className={clases} {...rest}>
      {children}
    </button>
  );
});