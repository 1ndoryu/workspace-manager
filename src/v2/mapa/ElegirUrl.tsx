/* Eleccion de destino al hacer click en una caja que corre en varios sitios.
 * [por que] El mapa no puede saber cual quiere la usuaria: se pregunta en el sitio del
 * click, sin sacarla de la vista ni abrir dos pestanas. Con una sola direccion no
 * aparece: se abre directa (ver MapaV2). */
import { useEffect, type CSSProperties } from 'react';
import type { UrlDestino } from '../../shared/types.js';
import { abrirPestana, bajarDocumento, suscribirDocumento } from '../../shared/platform/plataforma.js';
import { ETIQUETA_HUB } from './geometria/disposicion.js';

interface Props {
  id: string;
  urls: UrlDestino[];
  posicion: { x: number; y: number };
  onCerrar: () => void;
}

export function ElegirUrl({ id, urls, posicion, onCerrar }: Props) {
  /* Cierra con clic fuera o Escape, igual que el menu contextual. */
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    suscribirDocumento('pointerdown', onCerrar);
    suscribirDocumento('keydown', escape);
    return () => {
      bajarDocumento('pointerdown', onCerrar);
      bajarDocumento('keydown', escape);
    };
  }, [onCerrar]);

  return (
    <div
      className="mapaV2Elegir v2Superficie"
      role="menu"
      aria-label={`Abrir ${id}`}
      style={
        {
          // La posicion la publica el componente como CSS vars, como el tooltip.
          '--mapa-tip-x': `${posicion.x}px`,
          '--mapa-tip-y': `${posicion.y}px`,
        } as CSSProperties
      }
      /* Sin esto, el pointerdown del propio menu lo cerraria antes de que el
       * boton reciba el click. */
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mapaV2ElegirTitulo">{id}</div>
      {urls.map((u) => (
        <button
          key={u.url}
          type="button"
          role="menuitem"
          className="mapaV2ElegirItem"
          onClick={() => {
            abrirPestana(u.url);
            onCerrar();
          }}
        >
          <span className="mapaV2ElegirSitio">{ETIQUETA_HUB[u.donde]}</span>
          <span className="mapaV2ElegirUrl">{u.url}</span>
        </button>
      ))}
    </div>
  );
}
