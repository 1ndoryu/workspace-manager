/* Fila de Cajas hermanas con anchos arrastrables (299A-9).
 * [por que] Misma experiencia que el mapa: el divisor invisible de 12px
 * (--v2-gapPanel) entre cajas se arrastra con la primitiva central Resizer y
 * el reparto se persiste por fila (useAnchosFila). Sustituye al
 * `<div className="cajaFila">` con flex fijos por tab: cada tab declara sus
 * hijas (ids estables + defecto proporcional) y el tamano lo decide el
 * usuario, no la tab. */
import { Children, Fragment, useRef, type ReactNode } from 'react';
import { Resizer } from './Resizer.js';
import { useAnchosFila } from './useAnchosFila.js';

interface FilaCajasProps {
  /* Clave de persistencia (una por tab: 'vps', 'repos', ...). */
  fila: string;
  /* Ids estables en el mismo orden que los hijos (el condicional tambien:
   * p. ej. vps sin detalle son 2 ids, con detalle 3). */
  ids: string[];
  /* Proporcion inicial (los flex que tenia cada tab: vps [1,1,1.6], etc.). */
  defectos: number[];
  children: ReactNode;
}

export function FilaCajas({ fila, ids, defectos, children }: FilaCajasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lista = Children.toArray(children);
  const { fracs, ajustar } = useAnchosFila(fila, ids, defectos);

  return (
    <div className="cajaFila cajaFila--conDivisores" ref={ref}>
      {lista.map((hijo, i) => (
        <Fragment key={ids[i] ?? `hija-${i}`}>
          {i > 0 && (
            <Resizer
              orientacion="vertical"
              ariaLabel={`Ajustar ancho: ${ids[i - 1] ?? `hija-${i - 1}`} / ${ids[i] ?? `hija-${i}`}`}
              onArrastrar={(dx) =>
                ajustar(ref.current?.getBoundingClientRect().width ?? 0, i - 1, dx)
              }
            />
          )}
          <div
            className="cajaFilaCelda"
            style={{ flexGrow: fracs[i] ?? 1, flexShrink: 1, flexBasis: 0 }}
          >
            {hijo}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
