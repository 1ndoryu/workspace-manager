/* Estado de la página de avisos (20AA-29). Lee el mismo store que la campana y no guarda avisos
 * propios: dos copias de la misma lista acabarían diciendo cosas distintas.
 * [por que abre el canal igual que la campana] La página enseña avisos nuevos mientras está
 * abierta; si no abriera el canal, habría que recargar para ver lo que acaba de pasar. El canal
 * del tablero (`AppV2`) es otro tema; los avisos sólo viajan por éste.
 * [por que el filtro vive en el store] La campana y la página comparten `filtro`: cambiar de tipo
 * en una y abrir la otra no puede enseñar dos listas distintas sin que se note. */
import { useEffect, useState } from 'react';
import type { Aviso } from '../../shared/notificaciones/tipos.js';
import {
  agruparPorTiempo,
  contarAvisos,
  filtrarPorTipo,
  sinLeer,
} from '../../shared/notificaciones/presentacion.js';
import { abrirCanal } from './apiNotificaciones.js';
import { useCargaPorScroll } from './useCargaPorScroll.js';
import { useNotificaciones } from './useNotificaciones.js';

export function usePaginaAvisos() {
  const avisos = useNotificaciones((s) => s.avisos);
  const filtro = useNotificaciones((s) => s.filtro);
  const ahora = useNotificaciones((s) => s.ahora);
  const lista = useNotificaciones((s) => s.lista);
  const error = useNotificaciones((s) => s.error);
  const fuentesRotas = useNotificaciones((s) => s.fuentesRotas);
  const campana = useNotificaciones((s) => s.campana);
  const cargar = useNotificaciones((s) => s.cargar);
  const recibir = useNotificaciones((s) => s.recibir);
  const actualizarReloj = useNotificaciones((s) => s.actualizarReloj);
  const setFiltro = useNotificaciones((s) => s.setFiltro);
  const marcar = useNotificaciones((s) => s.marcar);

  /* El detalle guarda el id, no el aviso: el objeto del store se sustituye al marcarlo leído y
   * la caja abierta se quedaría con el de antes. */
  const [seleccionId, setSeleccionId] = useState<number | null>(null);
  const [marcando, setMarcando] = useState(false);

  /* Cambiar el filtro cierra el detalle: el aviso abierto puede ser de otro tipo y la caja diría
   * algo que la lista a su izquierda ya no enseña. */
  useEffect(() => {
    setSeleccionId(null);
  }, [filtro]);

  /* Apagada (20AA-32): se carga una vez para enseñar lo guardado, pero no se abre el canal: el
   * servidor contestaría 410 y el navegador reintentaría sin fin. */
  const activa = campana.activa;
  useEffect(() => {
    actualizarReloj();
    void cargar();
    if (!activa) return;
    const canal = abrirCanal(recibir, () => void cargar());
    return () => canal.cerrar();
  }, [activa, cargar, recibir, actualizarReloj]);

  const visibles = filtrarPorTipo(avisos, filtro);
  const grupos = agruparPorTiempo(visibles, ahora);
  const scroll = useCargaPorScroll(grupos);

  /* Abrir un aviso lo marca leído, igual que en la campana: si la página no lo hiciera, el contador
   * del nav seguiría alto después de haberlo leído aquí. La selección se refresca desde la lista
   * para que el detalle abierto refleje el «leído» al instante. */
  function abrir(aviso: Aviso): void {
    setSeleccionId(aviso.id);
    if (!aviso.leido) void marcar([aviso.id]);
  }

  /* «Marcar todo leído» se lleva lo que se ve y lo que no: es la lista filtrada entera, no el
   * tramo cargado. [por que `marcando`] La llamada tarda; sin el estado, dos clics seguidos
   * mandan dos POST idénticos. */
  async function marcarTodas(): Promise<void> {
    const pendientes = visibles.filter((a) => !a.leido).map((a) => a.id);
    if (pendientes.length === 0) return;
    setMarcando(true);
    try {
      await marcar(pendientes);
    } finally {
      setMarcando(false);
    }
  }

  return {
    campana,
    gruposVisibles: scroll.gruposVisibles,
    quedan: scroll.quedan,
    refLista: scroll.refLista,
    alDesplazar: scroll.alDesplazar,
    verMas: scroll.verMas,
    total: contarAvisos(grupos),
    noLeidos: sinLeer(avisos),
    lista,
    error,
    fuentesRotas,
    filtro,
    setFiltro,
    marcando,
    marcarTodas,
    seleccion: avisos.find((a) => a.id === seleccionId) ?? null,
    abrir,
    cerrar: () => setSeleccionId(null),
  };
}
