/* Lista de la pestaña Guardián: sustituye a las tablas.
 * [por que] Una tabla obliga a leer en columnas y a comparar celdas; aquí cada cosa
 * es una fila de una sola línea (nombre, detalle y dato) dentro de un cuadro. Si la
 * fila lleva `onClick` es un botón (elegir un proyecto); si no, texto. */
import type { ReactNode } from 'react';
import { Button } from '../../ui/form/Button.js';

/* Cuadro con scroll: una lista larga no alarga la pestaña. */
export function Lista({ children }: { children: ReactNode }) {
  return <div className="guardianCuadro guardianCuadro--scroll">{children}</div>;
}

interface LineaProps {
  titulo: ReactNode;
  /* Dato corto a la derecha: el estado o el valor. */
  dato?: ReactNode;
  /* Contexto tras el título; si no cabe se recorta, y el aviso completo sale al pasar el ratón. */
  detalle?: ReactNode;
  activa?: boolean;
  onClick?: () => void;
}

export function Linea({ titulo, dato, detalle, activa = false, onClick }: LineaProps) {
  const tieneDetalle = detalle !== undefined && detalle !== '';
  const cuerpo = (
    <span className="guardianLineaFila">
      <span className="guardianLineaTitulo" title={typeof titulo === 'string' ? titulo : undefined}>
        {titulo}
      </span>
      {tieneDetalle && (
        <span className="guardianLineaDetalle" title={typeof detalle === 'string' ? detalle : undefined}>
          {detalle}
        </span>
      )}
      {dato !== undefined && <span className="guardianLineaDato">{dato}</span>}
    </span>
  );
  const clase = `guardianLinea${activa ? ' guardianLinea--activa' : ''}`;
  if (onClick) {
    return (
      <Button type="button" className={clase} onClick={onClick} aria-pressed={activa}>
        {cuerpo}
      </Button>
    );
  }
  return <div className={clase}>{cuerpo}</div>;
}
