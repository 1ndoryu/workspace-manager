/* Cliente de la campana (20AA-25 N3): el estado por HTTP y los avisos nuevos por SSE.
 * [por que SSE y no sondeo] El servidor ya sabe cuándo hay algo nuevo; sondear cada segundo
 * costaría una petición por pestaña y por segundo para responder casi siempre «nada». Aquí hay una
 * conexión abierta que no gasta CPU mientras no pasa nada, y `EventSource` reconecta solo con
 * `Last-Event-ID`, así que no repite lo ya visto.
 * [por que no hay reintento propio] El navegador ya reintenta con espera creciente. Añadir otro
 * encima serían dos relojes para lo mismo. */
import axios from 'axios';
import type { Aviso, EstadoNotificaciones, TipoAviso } from '../../shared/notificaciones/tipos.js';
import {
  abrirCanalEventos,
  bajarDocumento,
  bajarVentana,
  pestanaVisible,
  suscribirDocumento,
  suscribirVentana,
} from '../../shared/platform/plataforma.js';

export async function cargarEstado(): Promise<EstadoNotificaciones> {
  const { data } = await axios.get<EstadoNotificaciones>('/api/notificaciones');
  return data;
}

export async function marcarLeidas(ids?: number[]): Promise<void> {
  await axios.post('/api/notificaciones/leidas', ids === undefined ? {} : { ids });
}

export async function silenciar(tipos: TipoAviso[]): Promise<void> {
  await axios.post('/api/notificaciones/silenciar', { tipos });
}

export interface CanalAvisos {
  cerrar: () => void;
}

/* Abre el canal y entrega cada aviso nuevo. `alVolver` se llama cuando el canal se REABRE tras un
 * corte o tras volver a la pestaña: en ese momento el servidor ya ha mandado lo que faltaba por
 * `Last-Event-ID`, y el store vuelve a pintar por si acaso.
 * [por que se cierra al ocultar la pestaña] Una pestaña en segundo plano no necesita el canal: el
 * servidor deja de hacer pasadas para nadie y no se gasta una conexión. Al volver se reabre y no
 * se pierde nada. */
export function abrirCanal(alAviso: (a: Aviso) => void, alVolver?: () => void): CanalAvisos {
  let fuente: EventSource | null = null;
  let yaConecto = false;

  const abrir = (): void => {
    if (fuente !== null || !pestanaVisible()) return;
    fuente = abrirCanalEventos('/api/notificaciones/eventos');
    fuente.addEventListener('aviso', (e) => {
      try {
        const datos = JSON.parse((e as MessageEvent).data) as { tipo: string; aviso: Aviso };
        if (datos.tipo === 'aviso' && datos.aviso) alAviso(datos.aviso);
      } catch {
        /* Un bloque ilegible no puede tumbar el canal: se descarta y el siguiente llega. */
      }
    });
    fuente.addEventListener('open', () => {
      if (yaConecto) alVolver?.();
      yaConecto = true;
    });
    /* Sin manejador, un error de red se anuncia como no capturado. El navegador reintenta solo. */
    fuente.addEventListener('error', () => undefined);
  };

  const cerrar = (): void => {
    fuente?.close();
    fuente = null;
  };

  const alVisibilidad = (): void => {
    if (pestanaVisible()) abrir();
    else cerrar();
  };

  abrir();
  suscribirDocumento('visibilitychange', alVisibilidad);
  /* La pestaña se cierra con el canal abierto: cerrarlo aquí evita un error en la consola. */
  const alSalir = (): void => cerrar();
  suscribirVentana('pagehide', alSalir);

  return {
    cerrar: () => {
      bajarDocumento('visibilitychange', alVisibilidad);
      bajarVentana('pagehide', alSalir);
      cerrar();
    },
  };
}
