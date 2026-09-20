/* Divisor arrastrable entre paneles (vertical u horizontal).
 * [por que] El usuario pidio poder cambiar el ancho de los paneles (y la
 * consola de abajo tambien cambia de alto). Un unico componente reutilizable:
 * captura el puntero y reporta el desplazamiento acumulado (dx, dy). */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface ResizerProps {
  orientacion: 'vertical' | 'horizontal';
  ariaLabel: string;
  onArrastrar: (dx: number, dy: number) => void;
}

export function Resizer({ orientacion, ariaLabel, onArrastrar }: ResizerProps) {
  const inicio = useRef<{ x: number; y: number } | null>(null);

  function iniciar(ev: ReactPointerEvent<HTMLDivElement>) {
    ev.preventDefault();
    inicio.current = { x: ev.clientX, y: ev.clientY };
    /* [por que] Captura solo con eventos reales: los sinteticos (tests) no
     * tienen puntero activo y setPointerCapture lanzaria excepcion. Con
     * captura el arrastre sigue aunque el puntero salga del divisor. */
    if (ev.isTrusted) ev.currentTarget.setPointerCapture(ev.pointerId);
  }

  function mover(ev: ReactPointerEvent<HTMLDivElement>) {
    const i = inicio.current;
    if (!i) return;
    /* [por que] Reporta el delta INCREMENTAL (desde el ultimo evento) y
     * actualiza el origen: si se reportara el delta acumulado desde el
     * inicio, el estado (ya actualizado en eventos previos) se reaplicaria
     * encima y el tamano cambiaria mucho mas que el movimiento del raton. */
    onArrastrar(ev.clientX - i.x, ev.clientY - i.y);
    i.x = ev.clientX;
    i.y = ev.clientY;
  }

  function terminar() {
    inicio.current = null;
  }

  return (
    <div
      className={`v2Resizer v2Resizer--${orientacion}`}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={orientacion}
      onPointerDown={iniciar}
      onPointerMove={mover}
      onPointerUp={terminar}
      onPointerCancel={terminar}
    />
  );
}
