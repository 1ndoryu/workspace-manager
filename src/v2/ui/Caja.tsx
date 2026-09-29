/* Caja: primitiva central de paneles v2 (299A-6).
 * [por que] Cada tab habia inventado su propia caja (mapa: una con borde en
 * el marco; docs: dos propias; repos: una propia; vps: una con zonas
 * internas) y no habia distincion entre panel externo e interno. A partir de
 * aqui: `Caja` es el panel EXTERNO (borde 1px, cabecera con titulo/acciones/
 * cierre, cuerpo que llena el espacio) y `Seccion` es el panel INTERNO
 * (subdivision sin borde dentro de una Caja: titulillo + contenido).
 * Reglas: sin radios, sin sombras, sin bold; el estado se marca con
 * relleno/borde, no con color. */
import type { ReactNode } from 'react';
import './Caja.css';

type CajaProps = {
  titulo?: ReactNode;
  acciones?: ReactNode;
  onCerrar?: () => void;
  cerrarTitulo?: string;
  /* Cuerpo en columna sin scroll propio: para contenido que llena (p. ej.
   * un textarea con flex 1). Por defecto el cuerpo hace scroll interno. */
  columna?: boolean;
  className?: string;
  etiqueta?: string;
  children: ReactNode;
};

export function Caja({
  titulo,
  acciones,
  onCerrar,
  cerrarTitulo = 'cerrar',
  columna = false,
  className,
  etiqueta,
  children,
}: CajaProps) {
  return (
    <section
      className={`caja${className ? ` ${className}` : ''}`}
      aria-label={typeof etiqueta === 'string' ? etiqueta : undefined}
    >
      {(titulo !== undefined || acciones !== undefined || onCerrar !== undefined) && (
        <header className="cajaCabecera">
          <span className="cajaTitulo">{titulo}</span>
          {acciones}
          {onCerrar !== undefined && (
            <button
              type="button"
              className="cajaCerrar"
              onClick={onCerrar}
              title={cerrarTitulo}
              aria-label={cerrarTitulo}
            >
              ×
            </button>
          )}
        </header>
      )}
      <div className={`cajaCuerpo${columna ? ' cajaCuerpo--columna' : ''}`}>{children}</div>
    </section>
  );
}

type SeccionProps = {
  titulo: ReactNode;
  acciones?: ReactNode;
  fallo?: boolean;
  children: ReactNode;
};

export function Seccion({ titulo, acciones, fallo = false, children }: SeccionProps) {
  return (
    <div className={`cajaSeccion${fallo ? ' cajaSeccion--fallo' : ''}`}>
      <h4 className="cajaSeccionTitulo">
        <span className="cajaSeccionNombre">{titulo}</span>
        {acciones}
      </h4>
      {children}
    </div>
  );
}
