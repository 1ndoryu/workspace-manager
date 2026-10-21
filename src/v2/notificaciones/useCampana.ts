/* Lógica de la campana (20AA-25 N3): carga inicial, canal en vivo, apertura/cierre y teclado.
 * [por que un hook] `componente-sin-hook-glory`: el componente queda con JSX y aquí vive el
 * estado y los efectos. El abrir/cerrar es el mismo hook del resto del shell (`useDesplegable`),
 * así que la campana se comporta igual que el menú del nav: clic fuera cierra, Escape cierra.
 * [por que el canal vive aquí y no en AppV2] El canal sólo tiene sentido mientras haya campana
 * montada; si el componente se desmonta, el canal se cierra y el servidor deja de latir. */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Aviso, TipoAviso } from '../../shared/notificaciones/tipos.js';
import { agruparPorDia, filtrarPorTipo, sinLeer } from '../../shared/notificaciones/presentacion.js';
import { useDesplegable } from '../ui/menu/useDesplegable.js';
import { abrirCanal } from './apiNotificaciones.js';
import { useNotificaciones } from './useNotificaciones.js';

export function useCampana() {
  const avisos = useNotificaciones((s) => s.avisos);
  const filtro = useNotificaciones((s) => s.filtro);
  const ahora = useNotificaciones((s) => s.ahora);
  const lista = useNotificaciones((s) => s.lista);
  const error = useNotificaciones((s) => s.error);
  const fuentesRotas = useNotificaciones((s) => s.fuentesRotas);
  const cargar = useNotificaciones((s) => s.cargar);
  const recibir = useNotificaciones((s) => s.recibir);
  const actualizarReloj = useNotificaciones((s) => s.actualizarReloj);
  const setFiltro = useNotificaciones((s) => s.setFiltro);
  const marcarTodas = useNotificaciones((s) => s.marcarTodas);
  const marcar = useNotificaciones((s) => s.marcar);

  /* [por que muestraTodo] Con un filtro puesto, la cabecera usa UN solo botón: quitar el filtro.
   * Dos botones (quitar filtro y marcar todas) decían y hacían casi lo mismo en una cabecera de
   * 360 px, y la usuaria pidió una campana minimalista. */
  const muestreTodo = avisos.length === 0 || filtro !== null || sinLeer(avisos) === 0;
  const accionCabecera = filtro !== null ? () => setFiltro(null) : marcarTodas;

  const { abierto, raiz, alternar, cerrar } = useDesplegable<HTMLSpanElement>();
  const [tipoAbierto, setTipoAbierto] = useState<TipoAviso | null>(null);
  const refBoton = useRef<HTMLButtonElement>(null);
  const refsItems = useRef<Array<HTMLButtonElement | null>>([]);

  /* Una sola carga al montar; el canal se abre en paralelo (trae la historia él mismo). */
  useEffect(() => {
    void cargar();
    const canal = abrirCanal(recibir, () => void cargar());
    return () => canal.cerrar();
  }, [cargar, recibir]);

  /* Al abrir se refresca el reloj y el estado. [por que no un temporizador] Un `setInterval`
   * pintando «hace 4 min» cada minuto en una pestaña olvidada es trabajo para nada: el texto se
   * recalcula al abrir y cada vez que llega un aviso. */
  useEffect(() => {
    if (!abierto) {
      setTipoAbierto(null);
      return;
    }
    actualizarReloj();
    void cargar();
    refsItems.current[0]?.focus();
  }, [abierto, actualizarReloj, cargar]);

  /* Un aviso nuevo mientras el panel está abierto también refresca el reloj. */
  useEffect(() => {
    if (abierto) actualizarReloj();
  }, [avisos, abierto, actualizarReloj]);

  /* Al cambiar el filtro, la fila enfocada puede desaparecer y el foco caería al <body>. */
  useEffect(() => {
    if (abierto) refsItems.current[0]?.focus();
  }, [filtro, abierto]);

  const visibles = filtrarPorTipo(avisos, filtro);
  const grupos = agruparPorDia(visibles, ahora);
  const noLeidos = sinLeer(avisos);

  function teclas(ev: ReactKeyboardEvent<HTMLSpanElement>): void {
    const items = refsItems.current.filter((n): n is HTMLButtonElement => n !== null);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      /* Escape cierra el filtro si está abierto; si no, el panel entero. Y el foco vuelve al
       * botón: sin eso, el tabulador siguiente arrancaría desde el <body>. */
      if (tipoAbierto !== null) setTipoAbierto(null);
      else {
        cerrar();
        refBoton.current?.focus();
      }
      return;
    }
    if (items.length === 0) return;
    const desde = items.indexOf(document.activeElement as HTMLButtonElement);
    const salto =
      ev.key === 'ArrowDown' ? desde + 1
      : ev.key === 'ArrowUp' ? desde - 1
      : ev.key === 'Home' ? 0
      : ev.key === 'End' ? items.length - 1
      : null;
    if (salto === null) return;
    ev.preventDefault();
    items[(salto + items.length) % items.length]?.focus();
  }

  function abrirAviso(aviso: Aviso): void {
    if (aviso.leido) return;
    void marcar([aviso.id]);
  }

  return {
    abierto,
    raiz,
    alternar,
    cerrar,
    refBoton,
    refsItems,
    teclas,
    tipoAbierto,
    setTipoAbierto,
    muestreTodo,
    accionCabecera,
    grupos,
    visibles,
    noLeidos,
    ahora,
    lista,
    error,
    fuentesRotas,
    filtro,
    setFiltro,
    marcarTodas,
    abrirAviso,
  };
}
