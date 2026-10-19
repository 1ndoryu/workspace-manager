/* Tooltip flotante del mapa: datos del proyecto bajo el puntero. Se posiciona
 * con variables CSS para no reflowar el SVG en cada movimiento del raton. */
import type { CSSProperties } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { anchoVentana } from '../../shared/platform/plataforma.js';

interface Props {
  proyecto: Proyecto;
  posicion: { x: number; y: number };
}

export function TooltipMapa({ proyecto: hover, posicion }: Props) {
  return (
    <div
      className="mapaV2Tooltip"
      style={
        {
          // [por que] Tope a la derecha: el tooltip de 240 px no se sale de la ventana junto al borde.
          '--mapa-tip-x': `${Math.min(posicion.x + 14, anchoVentana() - 240)}px`,
          '--mapa-tip-y': `${posicion.y + 14}px`,
        } as CSSProperties
      }
    >
      <div className="mapaV2TooltipTitulo">{hover.id}</div>
      {hover.ejecucion && (
        <div className="mapaV2TooltipDatos">
          <div>
            corre: {hover.ejecucion.donde === 'vps89' ? 'VPS 89' : 'laptop'} · modo {hover.ejecucion.modo ?? 'sin declarar'}
          </div>
        </div>
      )}
      {hover.despliegue && (
        <div className="mapaV2TooltipDatos">
          <div>coolify: {hover.despliegue.sitio} (VPS {hover.despliegue.vps})</div>
          <div>{hover.despliegue.dominio}</div>
        </div>
      )}
      {hover.esGit && hover.git ? (
        <div className="mapaV2TooltipDatos">
          <div>rama: {hover.git.rama}</div>
          <div>dirty: {hover.git.dirty ? 'sí' : 'no'}</div>
          <div>ahead: {hover.git.ahead} · behind: {hover.git.behind}</div>
          {hover.gate?.declarado && <div>gate: sí</div>}
        </div>
      ) : (
        <div className="mapaV2TooltipDatos">carpeta (no git)</div>
      )}
    </div>
  );
}
