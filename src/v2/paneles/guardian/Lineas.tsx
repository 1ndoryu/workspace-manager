/* Lista de líneas de la pestaña Guardián: sustituye a las tablas.
 * [por que] Una tabla obliga a leer en columnas y a comparar celdas; aquí cada cosa
 * es una línea con su nombre y un dato, y el detalle debajo, más tenue. Si la línea
 * lleva `onClick` es un botón (elegir un proyecto); si no, texto. */
import type { ReactNode } from 'react';
import { Button } from '../../ui/form/Button.js';

export function Lista({ children }: { children: ReactNode }) {
  return <div className="guardianLista">{children}</div>;
}

interface LineaProps {
  titulo: ReactNode;
  /* Dato corto a la derecha: el estado o el valor. */
  dato?: ReactNode;
  /* Segunda línea, tenue: el porqué o el contexto. */
  detalle?: ReactNode;
  activa?: boolean;
  onClick?: () => void;
}

export function Linea({ titulo, dato, detalle, activa = false, onClick }: LineaProps) {
  const cuerpo = (
    <>
      <span className="guardianLineaFila">
        <span className="guardianLineaTitulo">{titulo}</span>
        {dato !== undefined && <span className="guardianLineaDato">{dato}</span>}
      </span>
      {detalle !== undefined && detalle !== '' && <span className="guardianLineaDetalle">{detalle}</span>}
    </>
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
