/* Logica del Selector desplegable (estado + teclado + cierre por clic fuera).
 * [por que] componente-sin-hook-glory exige la logica con estado/efectos en
 * un hook dedicado; el componente queda solo con JSX. */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { bajarDocumento, suscribirDocumento } from '../../../shared/platform/plataforma.js';

export function useSelector(valor: string, opciones: string[], onChange: (v: string) => void) {
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const raiz = useRef<HTMLSpanElement>(null);

  /* Cierra por clic fuera mientras esta abierto. */
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: Event) => {
      if (raiz.current && e.target instanceof Node && !raiz.current.contains(e.target)) {
        setAbierto(false);
      }
    };
    suscribirDocumento('pointerdown', fuera);
    return () => {
      bajarDocumento('pointerdown', fuera);
    };
  }, [abierto]);

  function abrir() {
    setResaltado(Math.max(0, opciones.indexOf(valor)));
    setAbierto(true);
  }

  function elegir(v: string) {
    setAbierto(false);
    if (v !== valor) onChange(v);
  }

  function tecla(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setAbierto(false);
      return;
    }
    if (!abierto && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      abrir();
      return;
    }
    if (!abierto) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setResaltado((r) => Math.min(opciones.length - 1, r + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setResaltado((r) => Math.max(0, r - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      elegir(opciones[resaltado] ?? valor);
    }
  }

  return { abierto, resaltado, raiz, setAbierto, setResaltado, abrir, elegir, tecla };
}
