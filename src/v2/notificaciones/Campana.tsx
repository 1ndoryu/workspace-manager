/* Campana de avisos del nav (20AA-25 N3, rework 20AA-28).
 * [por que aquí y no un toast] Avisa de lo que cambia en el área sin interrumpir: un contador en
 * el nav y un panel que se abre cuando la usuaria quiere. Los toasts flotantes ya existen para
 * resultados de acciones; esto es el registro de lo que pasó.
 * [por que monocromo] El shell v2 es estrictamente blanco y negro: los niveles se distinguen por
 * relleno y borde, no por color (variables-v2.css). Lo de «sin leer» es un borde grueso, no un
 * color.
 * [por que sin título ni «marcar todas»] La cabecera sólo lleva lo que se usa: filtrar. El rótulo
 * «avisos» repetía el icono y «marcar todas» competía con abrir cada aviso, que ya lo marca leído.
 * [por que la hora va por bloques de 6 h] Una hora relativa por fila estorbaba más de lo que
 * informaba; el bloque, centrado, sitúa el aviso una sola vez por tramo y el detalle da la hora. */
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CheckCheck,
  CircleCheck,
  Globe,
  GlobeLock,
  Layers,
  ListFilter,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-react';
import type { Aviso, TipoAviso } from '../../shared/notificaciones/tipos.js';
import { ETIQUETA, NIVEL, TIPOS } from '../../shared/notificaciones/tipos.js';
import { etiquetaContador, etiquetaDia, diaLocal, horaLocal } from '../../shared/notificaciones/presentacion.js';
import { cuerpoDocumento } from '../../shared/platform/plataforma.js';
import { Button } from '../ui/form/Button.js';
import { useCampana } from './useCampana.js';
import { useNotificaciones } from './useNotificaciones.js';
import './Campana.css';

/* Icono de cada tipo. [por que aquí y no en el contrato] `tipos.ts` lo comparten el servidor y
 * los tests de Node: meter componentes de React allí arrastraría la UI al motor. Monocromos y a
 * 14 px, como el icono de la campana. */
const ICONO: Record<TipoAviso, typeof Bell> = {
  'tarea-nueva': Layers,
  'tarea-completada': CheckCheck,
  'problema-detectado': TriangleAlert,
  'problema-resuelto': CircleCheck,
  'sitio-caido': GlobeLock,
  'sitio-recuperado': Globe,
  'proyecto-caido': ShieldAlert,
  'proyecto-recuperado': ShieldCheck,
};

export function Campana() {
  const {
    abierto,
    raiz,
    alternar,
    refBoton,
    refsItems,
    teclas,
    vista,
    abrirAviso,
    cerrarVista,
    abrirFiltro,
    elegirFiltro,
    grupos,
    visibles,
    noLeidos,
    lista,
    error,
    fuentesRotas,
    filtro,
  } = useCampana();
  const silenciados = useNotificaciones((s) => s.silenciados);
  const alternarSilencio = useNotificaciones((s) => s.alternarSilencio);

  const contador = etiquetaContador(noLeidos);

  /* Fila con foco de la lista: sólo es parada de tabulador (0 o -1), se navega con flechas. */
  const enfocable = (gi: number, i: number): number => (gi === 0 && i === 0 ? 0 : -1);
  /* Índice plano de una fila. [por que] `refsItems` es la única lista que recorren las flechas:
   * si sólo se registra la primera fila, ArrowDown/ArrowUp giran sobre ella y el resto de la
   * lista queda inalcanzable con el teclado. */
  const indicePlano = (gi: number, i: number): number =>
    grupos.slice(0, gi).reduce((n, g) => n + g.avisos.length, i);

  return (
    <span className="v2Campana" ref={raiz}>
      <Button
        ref={refBoton}
        className="v2CampanaBoton"
        onClick={alternar}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={noLeidos > 0 ? `avisos: ${noLeidos} sin leer` : 'avisos'}
        title="avisos"
      >
        <Bell size={14} aria-hidden />
        {/* El contador se anuncia solo cuando cambia; el resto del panel no es una región viva. */}
        <span className="v2CampanaPunto" aria-live="polite" aria-atomic="true">
          {contador}
        </span>
      </Button>

      {abierto && (
        <span className="v2CampanaPanel v2Superficie" role="dialog" aria-label="Avisos" onKeyDown={teclas}>
          {/* Cabecera sin rótulo: sólo el filtro a la derecha, que es lo único que se pulsa. */}
          <span className="v2CampanaCabecera">
            <Button
              pequeno
              cuadrado
              activo={filtro !== null}
              onClick={abrirFiltro}
              title="filtrar por tipo"
              aria-label="filtrar por tipo"
            >
              <ListFilter size={13} aria-hidden />
            </Button>
          </span>

          {error !== null && (
            <span className="v2CampanaBanda" role="status">
              avisos sin conexión: {error}
            </span>
          )}
          {fuentesRotas.length > 0 && (
            <span className="v2CampanaBanda" role="status">
              {fuentesRotas.map((f) => f.fuente).join(', ')}: sin lectura, puede faltar algo
            </span>
          )}

          <span className="v2CampanaLista">
            {!lista && visibles.length === 0 && <span className="v2CampanaVacio">cargando…</span>}
            {lista && visibles.length === 0 && (
              <span className="v2CampanaVacio">{filtro !== null ? 'nada de ese tipo' : 'nada nuevo'}</span>
            )}
            {grupos.map((g, gi) => (
              <span className="v2CampanaGrupo" key={g.clave}>
                <span className="v2CampanaDia">{g.etiqueta}</span>
                {g.avisos.map((a, i) => (
                  <FilaAviso
                    key={a.id}
                    aviso={a}
                    tabIndex={enfocable(gi, i)}
                    refFila={(el) => {
                      const k = indicePlano(gi, i);
                      if (el) refsItems.current[k] = el;
                      else delete refsItems.current[k];
                    }}
                    onAbrir={abrirAviso}
                  />
                ))}
              </span>
            ))}
          </span>

          {vista?.tipo === 'detalle' && <DetalleAviso aviso={vista.aviso} onCerrar={cerrarVista} />}
          {vista?.tipo === 'filtro' && (
            <ModalFiltro
              filtro={filtro}
              silenciados={silenciados}
              onElegir={elegirFiltro}
              onSilenciar={(t) => void alternarSilencio(t)}
              onCerrar={cerrarVista}
            />
          )}
        </span>
      )}
    </span>
  );
}

/* Una fila de la lista. `button` nativo y no Button: la fila es texto de dos líneas a todo el
 * ancho, no un control del sistema (Button.css es para los botones del shell). Sin hora: el tramo
 * de 6 h ya la sitúa y la hora exacta está en el detalle. */
function FilaAviso({
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

/* Detalle de un aviso: todo lo que el motor guardó, no lo que cabía en una fila. Va dentro del
 * panel y no como modal a pantalla completa: es el mismo asunto, un paso más adentro.
 * [por que un campo por línea y no un JSON] Se lee, y el pie da el día y la hora exacta, que es
 * lo que la lista ya no enseña.
 * [por que no atrapa el foco] El panel entero es un diálogo; esto es una capa suya con su propio
 * Escape y un botón «volver» como primera parada del tabulador. */
function DetalleAviso({ aviso, onCerrar }: { aviso: Aviso; onCerrar: () => void }) {
  const Icono = ICONO[aviso.tipo];
  const fecha = new Date(aviso.cuando);
  const cuando = Number.isFinite(fecha.getTime())
    ? `${etiquetaDia(diaLocal(fecha), fecha)} · ${horaLocal(fecha)}`
    : aviso.cuando;
  const refVolver = useRef<HTMLButtonElement>(null);

  return (
    <span
      className="v2CampanaDetallePanel v2Superficie"
      role="dialog"
      aria-modal="true"
      aria-label={`detalle: ${aviso.titulo}`}
      ref={() => refVolver.current?.focus()}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          onCerrar();
        }
      }}
    >
      <span className="v2CampanaDetalleCabecera">
        <Button ref={refVolver} pequeno cuadrado onClick={onCerrar} title="volver" aria-label="volver">
          <ArrowLeft size={13} aria-hidden />
        </Button>
        <Icono size={14} aria-hidden />
        <span className="v2CampanaDetalleTipo">{ETIQUETA[aviso.tipo]}</span>
      </span>

      <span className={`v2CampanaDetalleCuerpo${NIVEL[aviso.tipo] === 'alta' ? ' v2CampanaDetalleCuerpo--alta' : ''}`}>
        <span className="v2CampanaDetalleTitulo">{aviso.titulo}</span>
        {aviso.detalle !== '' && <span className="v2CampanaDetalleTexto">{aviso.detalle}</span>}
        <span className="v2CampanaDetallePie">
          <span>{cuando}</span>
          <span>
            {aviso.fuente}
            {aviso.clave !== '' ? ` · ${aviso.clave}` : ''}
          </span>
          {aviso.agrupados > 1 && <span>{aviso.agrupados} avisos agrupados</span>}
          <span>{NIVEL[aviso.tipo] === 'alta' ? 'sale fuera de la app' : 'sólo en la campana'}</span>
        </span>
      </span>
    </span>
  );
}

/* Filtro por tipo: modal centrado a pantalla completa. [por que modal y no un desplegable] Con
 * ocho tipos, cada uno con su silencio al lado, la lista no cabía dentro del panel de 360 px sin
 * taparlo. Centrado, cada tipo se toca una vez y el clic fuera cierra.
 * [por que en un portal] El panel vive dentro del nav, que recorta por medida: en absoluto se
 * vería cortado. El portal lo pinta sobre todo lo demás, igual que el modal de tareas. */
function ModalFiltro({
  filtro,
  silenciados,
  onElegir,
  onSilenciar,
  onCerrar,
}: {
  filtro: TipoAviso | null;
  silenciados: TipoAviso[];
  onElegir: (t: TipoAviso | null) => void;
  onSilenciar: (t: TipoAviso) => void;
  onCerrar: () => void;
}) {
  return createPortal(
    <span className="v2CampanaFondo" data-portal="" onClick={onCerrar}>
      <span
        className="v2CampanaModal v2Superficie"
        role="dialog"
        aria-modal="true"
        aria-label="filtrar por tipo"
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.stopPropagation();
            onCerrar();
          }
        }}
      >
        <span className="v2CampanaModalCabecera">
          <span className="v2CampanaModalTitulo">tipo</span>
          <Button pequeno cuadrado onClick={onCerrar} title="cerrar" aria-label="cerrar">
            <X size={13} aria-hidden />
          </Button>
        </span>

        <span className="v2CampanaModalGrid">
          <span className="v2CampanaModalFila v2CampanaModalFila--todos">
            <Button
              pequeno
              activo={filtro === null}
              aria-pressed={filtro === null}
              onClick={() => onElegir(null)}
              className="v2CampanaModalTipo"
            >
              <Bell size={13} aria-hidden />
              todos
            </Button>
          </span>
          {TIPOS.map((t) => {
            const Icono = ICONO[t];
            const callado = silenciados.includes(t);
            return (
              <span key={t} className="v2CampanaModalFila">
                <Button
                  pequeno
                  activo={filtro === t}
                  aria-pressed={filtro === t}
                  onClick={() => onElegir(t)}
                  className="v2CampanaModalTipo"
                >
                  <Icono size={13} aria-hidden />
                  {ETIQUETA[t]}
                </Button>
                {/* Silenciar no filtra: deja de salir como toast del sistema (20AA-27). */}
                <Button
                  pequeno
                  cuadrado
                  activo={callado}
                  onClick={() => onSilenciar(t)}
                  aria-pressed={callado}
                  title={callado ? `volver a avisar de ${ETIQUETA[t]}` : `no mostrar ${ETIQUETA[t]} fuera de la app`}
                  aria-label={callado ? `activar ${ETIQUETA[t]}` : `silenciar ${ETIQUETA[t]} fuera de la app`}
                >
                  <BellOff size={13} aria-hidden />
                </Button>
              </span>
            );
          })}
        </span>

        <span className="v2CampanaModalPie">
          {/* El icono marcado significa «no sale como toast de Windows»; la campana lo sigue
           * enseñando. Sin esta línea, el icono sería un misterio. */}
          <BellOff size={12} aria-hidden />
          <span>no sale fuera de la app</span>
        </span>
      </span>
    </span>,
    cuerpoDocumento(),
  );
}
