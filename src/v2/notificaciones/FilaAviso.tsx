/* Fila de un aviso y su detalle: lo comparten la campana y la página de avisos (20AA-29).
 * [por que aquí y no dentro de cada uno] Si la fila de la campana y la de la página divergieran,
 * el mismo aviso se leería distinto según dónde se mire. Un solo componente, dos contenedores.
 * [por que esta carpeta y no `presentacion.ts`] `tipos.ts` y `presentacion.ts` los importa el
 * servidor y los tests de Node: meter componentes de React allí arrastraría la UI al motor. */
import type { ReactNode } from 'react';
import {
  Bell,
  CheckCheck,
  CircleCheck,
  Globe,
  GlobeLock,
  Layers,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { Aviso, TipoAviso } from '../../shared/notificaciones/tipos.js';
import { ETIQUETA, NIVEL } from '../../shared/notificaciones/tipos.js';
import { diaLocal, etiquetaDia, horaLocal } from '../../shared/notificaciones/presentacion.js';

/* Icono de cada tipo. Monocromos y a 14 px, como el icono de la campana. [por que `as const
 * satisfies`] Es un mapa de constantes: nadie debe poder reasignar una entrada y las mutaciones
 * se verían en todos los importadores. `satisfies` conserva la comprobación contra el tipo. */
export const ICONO = {
  'tarea-nueva': Layers,
  'tarea-completada': CheckCheck,
  'problema-detectado': TriangleAlert,
  'problema-resuelto': CircleCheck,
  'sitio-caido': GlobeLock,
  'sitio-recuperado': Globe,
  'proyecto-caido': ShieldAlert,
  'proyecto-recuperado': ShieldCheck,
} as const satisfies Record<TipoAviso, typeof Bell>;

/* Una fila de la lista. `button` nativo y no Button: la fila es texto de dos líneas a todo el
 * ancho, no un control del sistema. Sin hora: el tramo de 6 h ya la sitúa y la hora exacta está en
 * el detalle. */
export function FilaAviso({
  aviso,
  tabIndex,
  refFila,
  onAbrir,
}: {
  aviso: Aviso;
  tabIndex: number;
  refFila: (el: HTMLButtonElement | null) => void;
  onAbrir: (a: Aviso) => void;
}) {
  const Icono = ICONO[aviso.tipo];
  return (
    <button
      type="button"
      ref={refFila}
      tabIndex={tabIndex}
      className={`v2CampanaAviso${aviso.leido ? '' : ' v2CampanaAviso--nuevo'}`}
      onClick={() => onAbrir(aviso)}
    >
      <Icono size={14} className="v2CampanaIcono" aria-hidden />
      <span className="v2CampanaTexto">
        <span className="v2CampanaTituloAviso">{aviso.titulo}</span>
        {aviso.detalle !== '' && <span className="v2CampanaDetalle">{aviso.detalle}</span>}
      </span>
    </button>
  );
}

/* Detalle de un aviso: todo lo que el motor guardó, no lo que cabía en una fila.
 * [por que un campo por línea y no un JSON] Se lee, y el pie da el día y la hora exacta, que es
 * lo que la lista ya no enseña. `extra` deja a cada contenedor añadir algo debajo; hoy ninguno
 * lo usa. */
export function DetalleAviso({ aviso, extra }: { aviso: Aviso; extra?: ReactNode }) {
  const Icono = ICONO[aviso.tipo];
  const fecha = new Date(aviso.cuando);
  const cuando = Number.isFinite(fecha.getTime())
    ? `${etiquetaDia(diaLocal(fecha), fecha)} · ${horaLocal(fecha)}`
    : aviso.cuando;

  return (
    <span className={`v2CampanaDetalleCuerpo${NIVEL[aviso.tipo] === 'alta' ? ' v2CampanaDetalleCuerpo--alta' : ''}`}>
      <span className="v2CampanaDetalleTitulo">
        <Icono size={14} aria-hidden /> {aviso.titulo}
      </span>
      {aviso.detalle !== '' && <span className="v2CampanaDetalleTexto">{aviso.detalle}</span>}
      <span className="v2CampanaDetallePie">
        <span>{cuando}</span>
        <span>
          {ETIQUETA[aviso.tipo]} · {aviso.fuente}
          {aviso.clave !== '' ? ` · ${aviso.clave}` : ''}
        </span>
        {aviso.agrupados > 1 && <span>{aviso.agrupados} avisos agrupados</span>}
        <span>{NIVEL[aviso.tipo] === 'alta' ? 'sale fuera de la app' : 'sólo dentro de la app'}</span>
      </span>
      {extra}
    </span>
  );
}
