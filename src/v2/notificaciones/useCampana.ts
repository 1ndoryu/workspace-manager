/* Lógica de la campana (20AA-25 N3, rework 20AA-28): carga inicial, canal en vivo, apertura/cierre,
 * detalle de un aviso y filtro por tipo en un modal centrado.
 * [por que un hook] `componente-sin-hook-glory`: el componente queda con JSX y aquí vive el
 * estado y los efectos. El abrir/cerrar es el mismo hook del resto del shell (`useDesplegable`),
 * así que la campana se comporta igual que el menú del nav: clic fuera cierra, Escape cierra.
 * [por que el canal vive aquí y no en AppV2] El canal sólo tiene sentido mientras haya campana
 * montada; si el componente se desmonta, el canal se cierra y el servidor deja de latir. */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Aviso, TipoAviso } from '../../shared/notificaciones/tipos.js';
import { agruparPorTiempo, filtrarPorTipo, sinLeer } from '../../shared/notificaciones/presentacion.js';
import { useDesplegable } from '../ui/menu/useDesplegable.js';
import { abrirCanal } from './apiNotificaciones.js';
import { useNotificaciones } from './useNotificaciones.js';

/* Qué se está mirando además de la lista: el detalle de un aviso o el filtro por tipo (modal
 * centrado). Son excluyentes: el panel no lleva dos capas superpuestas a la vez. */
export type Vista = { tipo: 'detalle'; aviso: Aviso } | { tipo: 'filtro' } | null;

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
  const marcar = useNotificaciones((s) => s.marcar);

  const { abierto, raiz, alternar, cerrar } = useDesplegable<HTMLSpanElement>();
  const [vista, setVista] = useState<Vista>(null);
  const refBoton = useRef<HTMLButtonElement>(null);
  const refsItems = useRef<Array<HTMLButtonElement | null>>([]);

  /* Una sola carga al montar; el canal se abre en paralelo (trae la historia él mismo). */
  useEffect(() => {
    void cargar();
    const canal = abrirCanal(recibir, () => void cargar());
    return () => canal.cerrar();
  }, [cargar, recibir]);

  /* Al abrir se refresca el reloj y el estado, y el foco entra en la lista. [por que no un
   * temporizador] Un `setInterval` repintando la lista en una pestaña olvidada es trabajo para
   * nada: el dato se refresca al abrir y cada vez que llega un aviso. */
  useEffect(() => {
    if (!abierto) {
      setVista(null);
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
    if (abierto && vista === null) refsItems.current[0]?.focus();
  }, [filtro, abierto, vista]);

  const visibles = filtrarPorTipo(avisos, filtro);
  const grupos = agruparPorTiempo(visibles, ahora);
  const noLeidos = sinLeer(avisos);

  function teclas(ev: ReactKeyboardEvent<HTMLSpanElement>): void {
    /* Con el detalle o el filtro abiertos, el teclado es suyo: el modal atrapa Escape. */
    if (vista !== null) return;
    const items = refsItems.current.filter((n): n is HTMLButtonElement => n !== null);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      /* Y el foco vuelve al botón: sin eso, el tabulador siguiente arrancaría desde el <body>. */
      cerrar();
      refBoton.current?.focus();
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

  /* Abrir el detalle marca leído. [por que se marca al abrir y no al cerrar] Es el momento en
   * que la usuaria ve el contenido; esperar al cierre dejaría el contador alto mientras lee. */
  function abrirAviso(aviso: Aviso): void {
    setVista({ tipo: 'detalle', aviso });
    if (!aviso.leido) void marcar([aviso.id]);
  }

  function cerrarVista(): void {
    setVista(null);
    /* El foco vuelve a la lista, no al <body>: se sigue navegando con las flechas. */
    requestAnimationFrame(() => refsItems.current[0]?.focus());
  }

  function elegirFiltro(tipo: TipoAviso | null): void {
    setFiltro(tipo);
    setVista(null);
  }

  return {
    abierto,
    raiz,
    alternar,
    cerrar,
    refBoton,
    refsItems,
    teclas,
    vista,
    abrirAviso,
    cerrarVista,
    elegirFiltro,
    abrirFiltro: () => setVista({ tipo: 'filtro' }),
    grupos,
    visibles,
    noLeidos,
    lista,
    error,
    fuentesRotas,
    filtro,
  };
}
