/* Tooltip flotante del mapa: nombre del proyecto y la URL de donde corre.
 * [por que] Solo la direccion: los demas datos (rama, gate, despliegue) ya estan
 * en el panel de detalle, y el tooltip tapaba el mapa. Se posiciona con
 * variables CSS para no reflowar el SVG en cada movimiento del raton. */
import { useMemo, type CSSProperties } from 'react';
import type { Proyecto, UrlDestino } from '../../shared/types.js';
import { anchoVentana } from '../../shared/platform/plataforma.js';
import { useConexiones } from '../useConexiones.js';

interface Props {
  proyecto: Proyecto;
  posicion: { x: number; y: number };
}

/* Ancho maximo del tooltip (mapaV2Tooltip): el tope de posicion usa el mismo
 * numero para que no se salga por la derecha. */
const ANCHO_TIP = 280;

/* URLs de los sitios donde el proyecto corre ahora, en el orden del mapa.
 * [por que] `destinos` es la misma fuente viva que usan mapa y lista: si corre
 * en dos sitios, salen las dos direcciones; si no corre en ninguno, ninguna. */
function urlsVivas(urls: UrlDestino[] | undefined, destinos: readonly string[]): string[] {
  if (!urls || destinos.length === 0) return [];
  const porSitio = new Map(urls.map((u) => [u.donde, u.url]));
  return destinos.flatMap((d) => {
    const url = porSitio.get(d as UrlDestino['donde']);
    return url ? [url] : [];
  });
}

export function TooltipMapa({ proyecto: hover, posicion }: Props) {
  const { destinos } = useConexiones();
  const urls = useMemo(
    () => urlsVivas(hover.urls, destinos.get(hover.clave) ?? []),
    [hover.urls, destinos, hover.clave],
  );

  return (
    <div
      className="mapaV2Tooltip"
      style={
        {
          // [por que] Tope a la derecha: el tooltip no se sale de la ventana junto al borde.
          '--mapa-tip-x': `${Math.min(posicion.x + 14, anchoVentana() - ANCHO_TIP)}px`,
          '--mapa-tip-y': `${posicion.y + 14}px`,
        } as CSSProperties
      }
    >
      <div className="mapaV2TooltipTitulo">{hover.id}</div>
      {urls.length === 0 ? (
        <div className="mapaV2TooltipUrl mapaV2TooltipUrl--apagada">no corre ahora mismo</div>
      ) : (
        urls.map((url) => (
          <div key={url} className="mapaV2TooltipUrl">
            {url}
          </div>
        ))
      )}
    </div>
  );
}
