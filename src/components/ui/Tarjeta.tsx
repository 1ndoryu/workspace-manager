/* Componente atomico: Tarjeta (panel contenedor).
 * [por que] Superficie unica reutilizada en lista, detalle y mapa. */
import type { ReactNode } from 'react';
import './tarjeta.css';

export interface TarjetaProps {
  children: ReactNode;
  titulo?: string;
  accion?: ReactNode;
  className?: string;
}

export function Tarjeta({ children, titulo, accion, className }: TarjetaProps) {
  return (
    <section className={`tarjeta ${className ?? ''}`}>
      {(titulo || accion) && (
        <header className="tarjetaCabecera">
          {titulo && <h2 className="tarjetaTitulo">{titulo}</h2>}
          {accion && <div className="tarjetaAccion">{accion}</div>}
        </header>
      )}
      <div className="tarjetaCuerpo">{children}</div>
    </section>
  );
}
