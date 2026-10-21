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
    /* Lo que cuelga de `body` por un portal (un modal, un submenu) es parte del desplegable aunque
     * no sea hijo suyo en el DOM: sin esto, pulsar dentro del portal cerraria el panel antes de
     * que el clic llegara a su boton. Se marca con `data-portal` el contenedor del portal. */
    const dentro = (nodo: Node | null): boolean =>
      raiz.current !== null &&
      (raiz.current.contains(nodo) || (nodo instanceof Element && nodo.closest('[data-portal]') !== null));
    const fuera = (e: Event) => {
      if (raiz.current && e.target instanceof Node && !dentro(e.target)) {
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
