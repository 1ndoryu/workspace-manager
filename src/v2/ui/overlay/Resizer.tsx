/* Divisor arrastrable entre paneles (vertical u horizontal).
 * [por que] El usuario pidio poder cambiar el ancho de los paneles (y la
 * consola de abajo tambien cambia de alto). Un unico componente reutilizable:
 * captura el puntero y reporta el desplazamiento acumulado (dx, dy).
 * [por que] Tambien se maneja con teclado: llevaba `role="separator"` sin
 * `tabIndex` ni teclas, asi que anunciaba un control que no existia y quien no
 * usa raton no podia cambiar el tamano de nada. Las flechas sintetizan el mismo
 * delta que daria el puntero, asi que las tres convenciones de signo de quien
 * lo usa (detalle +dx, lista -dx, consola -dy) se respetan sin duplicarlas. */
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

/* Cuanto mueve una pulsacion. Con Shift, cuatro veces mas: el salto grande es
 * comodo y no obliga a mantener la tecla. */
const PASO = 16;
const PASO_MAYOR = 64;

interface ResizerProps {
  orientacion: 'vertical' | 'horizontal';
  ariaLabel: string;
  onArrastrar: (dx: number, dy: number) => void;
  /* Tamano actual y limites del panel que ajusta. Solo para el valor que anuncia
   * el lector; quien decide los limites de verdad es `onArrastrar`. */
  valor?: number;
  min?: number;
  max?: number;
}

export function Resizer({ orientacion, ariaLabel, onArrastrar, valor, min, max }: ResizerProps) {
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

  /* Solo las flechas del eje que se ajusta: en un divisor vertical, arriba y
   * abajo no significan nada y moverian el panel en una direccion que el
   * usuario no ha pedido. */
  function tecla(ev: ReactKeyboardEvent<HTMLDivElement>) {
    const paso = ev.shiftKey ? PASO_MAYOR : PASO;
    const dx = orientacion === 'vertical'
      ? (ev.key === 'ArrowRight' ? paso : ev.key === 'ArrowLeft' ? -paso : 0)
      : 0;
    const dy = orientacion === 'horizontal'
      ? (ev.key === 'ArrowDown' ? paso : ev.key === 'ArrowUp' ? -paso : 0)
      : 0;
    if (dx === 0 && dy === 0) return;
    ev.preventDefault();
    onArrastrar(dx, dy);
  }

  return (
    <div
      className={`v2Resizer v2Resizer--${orientacion}`}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={orientacion}
      aria-valuenow={valor}
      aria-valuemin={valor === undefined ? undefined : min}
      aria-valuemax={valor === undefined ? undefined : max}
      tabIndex={0}
      onKeyDown={tecla}
      onPointerDown={iniciar}
      onPointerMove={mover}
      onPointerUp={terminar}
      onPointerCancel={terminar}
    />
  );
}
