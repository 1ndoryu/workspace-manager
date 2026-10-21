/* Campana de avisos del nav (20AA-25 N3).
 * [por que aquí y no un toast] Avisa de lo que cambia en el área sin interrumpir: un contador en
 * el nav y un panel que se abre cuando la usuaria quiere. Los toasts flotantes ya existen para
 * resultados de acciones; esto es el registro de lo que pasó.
 * [por que monocromo] El shell v2 es estrictamente blanco y negro: los niveles se distinguen por
 * relleno y borde, no por color (variables-v2.css). Lo de «sin leer» es un borde grueso, no un
 * color.
 * [por que arranca cerrada] La historia está ahí al abrir; anunciar de golpe 20 cosas de ayer al
 * arrancar sería ruido, justo lo que la usuaria no quería. */
import { Bell } from 'lucide-react';
import type { Aviso, TipoAviso } from '../../shared/notificaciones/tipos.js';
import { ETIQUETA } from '../../shared/notificaciones/tipos.js';
import { etiquetaContador, hace } from '../../shared/notificaciones/presentacion.js';
import { Button } from '../ui/form/Button.js';
import { useCampana } from './useCampana.js';
import { useNotificaciones } from './useNotificaciones.js';
import './Campana.css';

const TIPOS: TipoAviso[] = [
  'tarea-nueva',
  'tarea-completada',
  'problema-detectado',
  'problema-resuelto',
  'sitio-caido',
  'sitio-recuperado',
];

export function Campana() {
  const {
    abierto,
    raiz,
    alternar,
    refBoton,
    refsItems,
    teclas,
    tipoAbierto,
    setTipoAbierto,
    grupos,
    visibles,
    noLeidos,
    ahora,
    lista,
    error,
    fuentesRotas,
    filtro,
    setFiltro,
    muestreTodo,
    accionCabecera,
    abrirAviso,
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
          <span className="v2CampanaCabecera">
            <span className="v2CampanaTitulo">avisos</span>
            <span className="v2CampanaAcciones">
              <Button
                pequeno
                onClick={accionCabecera}
                title={filtro !== null ? 'quitar el filtro' : 'marcar todas como leídas'}
              >
                {muestreTodo ? (filtro !== null ? 'ver todos' : 'todo leído') : 'marcar todas'}
              </Button>
              <Button
                pequeno
                activo={tipoAbierto !== null || filtro !== null}
                onClick={() => setTipoAbierto(tipoAbierto === null ? (filtro ?? TIPOS[0]) : null)}
                aria-haspopup="listbox"
                aria-expanded={tipoAbierto !== null}
                title="filtrar por tipo"
              >
                tipo
              </Button>
            </span>
          </span>

          {tipoAbierto !== null && (
            <span className="v2CampanaTipos v2Superficie" role="listbox" aria-label="Filtrar por tipo">
              <Button
                pequeno
                role="option"
                aria-selected={filtro === null}
                activo={filtro === null}
                onClick={() => {
                  setFiltro(null);
                  setTipoAbierto(null);
                }}
              >
                todos
              </Button>
              {TIPOS.map((t) => (
                <span key={t} className="v2CampanaTipoFila">
                  <Button
                    pequeno
                    role="option"
                    aria-selected={filtro === t}
                    activo={filtro === t}
                    onClick={() => {
                      setFiltro(t);
                      setTipoAbierto(null);
                    }}
                  >
                    {ETIQUETA[t]}
                  </Button>
                  {/* Silenciar no quita el aviso: deja de salir como toast del sistema (20AA-27). */}
                  <Button
                    pequeno
                    activo={silenciados.includes(t)}
                    onClick={() => void alternarSilencio(t)}
                    title={silenciados.includes(t) ? `volver a avisar de ${ETIQUETA[t]}` : `no mostrar ${ETIQUETA[t]} fuera de la app`}
                    aria-pressed={silenciados.includes(t)}
                    aria-label={silenciados.includes(t) ? `activar ${ETIQUETA[t]}` : `silenciar ${ETIQUETA[t]} fuera de la app`}
                  >
                    {silenciados.includes(t) ? 'avisar' : 'callar'}
                  </Button>
                </span>
              ))}
            </span>
          )}

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
              <span className="v2CampanaGrupo" key={g.dia}>
                <span className="v2CampanaDia">{g.etiqueta}</span>
                {g.avisos.map((a, i) => (
                  <FilaAviso
                    key={a.id}
                    aviso={a}
                    ahora={ahora}
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
        </span>
      )}
    </span>
  );
}

/* Una fila de la lista. `button` nativo y no Button: la fila es texto de dos líneas a todo el
 * ancho, no un control del sistema (Button.css es para los botones del shell). */
function FilaAviso({
  aviso,
  ahora,
  tabIndex,
  refFila,
  onAbrir,
}: {
  aviso: Aviso;
  ahora: number;
  tabIndex: number;
  refFila: (el: HTMLButtonElement | null) => void;
  onAbrir: (a: Aviso) => void;
}) {
  return (
    <button
      type="button"
      ref={refFila}
      tabIndex={tabIndex}
      className={`v2CampanaAviso${aviso.leido ? '' : ' v2CampanaAviso--nuevo'}`}
      onClick={() => onAbrir(aviso)}
    >
      <span className="v2CampanaHora">{hace(aviso.cuando, ahora)}</span>
      <span className="v2CampanaTexto">
        <span className="v2CampanaTituloAviso">{aviso.titulo}</span>
        {aviso.detalle !== '' && <span className="v2CampanaDetalle">{aviso.detalle}</span>}
      </span>
    </button>
  );
}
