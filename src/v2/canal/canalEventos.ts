/* Canal único del tablero en el cliente (20AA-24 F3.2).
 *   abrirCanal({ workspace, vivos })   una sola conexión por pestaña
 * [por que el embudo] El mapa, la lista, los paneles dev y la campana reaccionan al mismo cambio.
 * Si cada uno abriera su `EventSource`, una pestaña tendría tres conexiones y tres
 * `Last-Event-ID` que pueden desincronizarse entre sí. Aquí se abre una, se reparte por tema y
 * cada consumidor se suscribe a lo que le importa.
 * [por que el cierre al ocultar la pestaña] Con la pestaña en segundo plano el servidor apaga su
 * único latido; al volver, `EventSource` reconecta con `Last-Event-ID` y el servidor manda lo que
 * faltaba, así que no se pierde nada y no hay que sondear para «recuperar el tiempo perdido».
 * [por que no hay reintento propio] El navegador reintenta solo, con espera creciente. Un segundo
 * reloj encima sería dos fuentes de verdad para lo mismo. */
import type { SnapshotWorkspace } from '../../shared/types.js';
import {
  abrirCanalEventos,
  bajarDocumento,
  bajarVentana,
  pestanaVisible,
  suscribirDocumento,
  suscribirVentana,
} from '../../shared/platform/plataforma.js';

/** Lo mínimo que el mapa necesita: las MISMAS claves que decide `destinosDe`. `null` = esa
 *  fuente no contestó, que no es «no hay nada vivo». */
export interface Vivos {
  laptop: string[] | null;
  produccion: string[] | null;
}

export interface OyentesCanal {
  workspace?: (snapshot: SnapshotWorkspace) => void;
  vivos?: (vivos: Vivos) => void;
  /** Se llama al REABRIR tras un corte o al volver a la pestaña: el servidor ya mandó lo que
   *  faltaba y el consumidor puede re-pintar por si acaso. */
  alVolver?: () => void;
}

export interface CanalTablero {
  cerrar: () => void;
}

/* Lee un bloque SSE sin poder tumbar el canal: un JSON roto se descarta y el siguiente llega. */
function leer<T>(e: Event, alDato: (dato: T) => void): void {
  try {
    const bloque = JSON.parse((e as MessageEvent).data) as { datos?: T };
    if (bloque.datos !== undefined) alDato(bloque.datos);
  } catch {
    /* Nada que hacer: el evento se pierde, la conexión sigue. */
  }
}

/* Los temas del servidor. Se excluyen con `=0` en vez de enumerar los pedidos porque el servidor
 * interpreta «ninguno pedido» como «todos»: un canal mudo no tendría sentido. */
const TEMAS = ['workspace', 'vivos', 'avisos'] as const;

export function abrirCanal(oyentes: OyentesCanal): CanalTablero {
  let fuente: EventSource | null = null;
  let yaConecto = false;

  const abrir = (): void => {
    if (fuente !== null || !pestanaVisible()) return;
    /* Sólo se piden los temas con oyente: sin esto el mapa recibiría cada aviso de la campana. */
    const pedidos = new Set<string>();
    if (oyentes.workspace) pedidos.add('workspace');
    if (oyentes.vivos) pedidos.add('vivos');
    if (pedidos.size === 0) return;
    const excluir = TEMAS.filter((t) => !pedidos.has(t)).map((t) => `${t}=0`).join('&');
    fuente = abrirCanalEventos(`/api/eventos${excluir ? `?${excluir}` : ''}`);
    if (oyentes.workspace) fuente.addEventListener('workspace', (e) => leer<SnapshotWorkspace>(e, oyentes.workspace!));
    if (oyentes.vivos) fuente.addEventListener('vivos', (e) => leer<Vivos>(e, oyentes.vivos!));
    fuente.addEventListener('open', () => {
      if (yaConecto) oyentes.alVolver?.();
      yaConecto = true;
    });
    /* Sin manejador, un corte de red se anuncia como error no capturado. El navegador reintenta. */
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
