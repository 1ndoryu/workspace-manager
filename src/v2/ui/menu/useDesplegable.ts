/* Estado de un desplegable anclado a su disparador: abierto/cerrado y cierre
 * por clic fuera o Escape.
 * [por que] componente-sin-hook-glory exige la logica con estado y efectos en
 * un hook dedicado, para que el componente quede solo con JSX. */
import { useEffect, useRef, useState } from 'react';
import { bajarDocumento, suscribirDocumento } from '../../../shared/platform/plataforma.js';

export function useDesplegable<T extends HTMLElement = HTMLSpanElement>() {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<T>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: Event) => {
      if (raiz.current && e.target instanceof Node && !raiz.current.contains(e.target)) {
        setAbierto(false);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    suscribirDocumento('pointerdown', fuera);
    suscribirDocumento('keydown', escape);
    return () => {
      bajarDocumento('pointerdown', fuera);
      bajarDocumento('keydown', escape);
    };
  }, [abierto]);

  return {
    abierto,
    raiz,
    alternar: () => setAbierto((a) => !a),
    cerrar: () => setAbierto(false),
  };
}
