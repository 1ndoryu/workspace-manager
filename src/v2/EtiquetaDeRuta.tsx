/* Etiqueta de ruta tecnica con tooltip monocromo (portal al body).
 * [por que] El usuario pidio que el tooltip muestre unicamente la descripcion
 * detallada de la opcion: repetir el nombre o la ruta tecnica es redundante
 * porque la ruta ya se lee en la propia etiqueta. Se usa un portal al body
 * para que el tooltip no se recorte por el overflow de los paneles con scroll.
 * Vive en modulo propio para que EditorEsquema.tsx no supere el limite. */
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { altoVentana, anchoVentana, cuerpoDocumento } from '../shared/platform/plataforma.js';
import { rutaDetalle, rutaEtiqueta } from '../shared/gate/esquema.js';
import type { Ruta } from '../shared/gate/esquema.js';

export function EtiquetaDeRuta({ ruta, texto }: { ruta: Ruta; texto?: string }) {
  const detalle = rutaDetalle(ruta);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function mostrar() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const ANCHO = 340;
    let x = r.left;
    if (x + ANCHO > anchoVentana() - 8) x = Math.max(8, anchoVentana() - ANCHO - 8);
    const y = Math.min(r.bottom + 6, Math.max(8, altoVentana() - 180));
    setPos({ x, y });
  }

  return (
    <span
      ref={ref}
      className="ejRutaTexto"
      onMouseEnter={mostrar}
      onMouseLeave={() => setPos(null)}
    >
      <span className="ejRutaNombre">{texto ?? rutaEtiqueta(ruta)}</span>
      {pos &&
        detalle &&
        createPortal(
          <div
            className="ejTooltip"
            style={{ '--tooltip-x': `${pos.x}px`, '--tooltip-y': `${pos.y}px` } as CSSProperties}
            role="tooltip"
          >
            <span className="ejTooltipDetalle">{detalle}</span>
          </div>,
          cuerpoDocumento(),
        )}
    </span>
  );
}
