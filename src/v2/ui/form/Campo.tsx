/* Campo de formulario del shell v2: etiqueta, control y ayuda en una columna.
 * [por que] Cada panel ordenaba sus campos con clases propias, y el Selector no
 * encajaba con los textarea (otro alto y otro borde). Aquí viven el orden y la forma
 * del campo; el panel solo pone el control. Estilos en Campo.css. */
import type { ReactNode } from 'react';
import './Campo.css';

export interface CampoProps {
  etiqueta: ReactNode;
  /* id del control que la etiqueta nombra; sin él la etiqueta es solo texto. */
  htmlFor?: string;
  /* Frase corta bajo el control: qué significa el valor. */
  ayuda?: string;
  /* Texto de código (JSON, argumentos): fuente monoespaciada. */
  codigo?: boolean;
  children: ReactNode;
}

export function Campo({ etiqueta, htmlFor, ayuda, codigo = false, children }: CampoProps) {
  const clase = `v2Campo${codigo ? ' v2Campo--codigo' : ''}`;
  return (
    <div className={clase}>
      <label htmlFor={htmlFor}>{etiqueta}</label>
      {children}
      {ayuda && <span className="v2CampoAyuda">{ayuda}</span>}
    </div>
  );
}
