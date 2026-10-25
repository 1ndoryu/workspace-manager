/* Muestreo de recursos en segundo plano (20AA-17).
 * [por que en el servidor] El navegador no puede hacerlo: una pestaña de fondo limita
 * sus temporizadores a ~1/minuto y con el tablero cerrado no muestrea nadie, así que
 * el historial solo cubría los ratos con el panel a la vista y empezaba de cero cada
 * vez. El servidor sí está siempre en marcha.
 * [por que despacio] El anillo es decorativo: un minuto de cadencia da una serie
 * suficiente (el rango más corto es de 30 min) sin competir con lo que el tablero ya
 * pide a pulse. Nunca lanza: sin fuente configurada o con pulse caído, simplemente
 * no hay muestra y se reintenta en la siguiente pasada. */
import type { VpsAgenteSnapshot } from '../../shared/tipos/vps.js';
import {
  TABS_RECURSOS,
  muestraDeSnapshot,
  type TabRecursos,
} from '../../shared/recursosHistorial.js';
import { agenteProd } from '../vps/agente.js';
import { agenteTaller } from '../taller/agenteTaller.js';
import { anotarSitiosVps } from '../vps/rutas/rutasVps.js';
import { historialRecursosProd, type crearHistorialRecursos } from './historial.js';

/* Cadencia del fondo. Lenta a propósito (20AA-17): un minuto. */
export const MUESTREO_MS = 60_000;

export interface OpcionesMuestreador {
  historial: ReturnType<typeof crearHistorialRecursos>;
  /* Snapshot por tab; null = esa fuente no está configurada (p. ej. sin token). */
  fuentes: Record<TabRecursos, () => Promise<VpsAgenteSnapshot | null>>;
  /* Anillo por sitio de vps (20AA-18): recibe cada snapshot de vps ya leído. Opcional: sin él solo
   * corre el anillo de recursos (pruebas). */
  sitiosVps?: (snap: VpsAgenteSnapshot) => void;
  intervaloMs?: number;
  ahora?: () => number;
}

export interface EstadoMuestreo {
  pasadas: number;
  muestras: number;
  ultimoError: string | null;
  detenido: boolean;
}

export function crearMuestreador(op: OpcionesMuestreador) {
  const intervalo = op.intervaloMs ?? MUESTREO_MS;
  const ahora = op.ahora ?? Date.now;
  /* Último IO del host visto por tab: los contadores se repiten entre muestras
   * mientras pulse no los traiga (plano = sin dato, no cero). */
  const disco = new Map<TabRecursos, { r: number; w: number } | null>();
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let detenido = false;
  let corriendo = false;
  let pasadas = 0;
  let muestras = 0;
  let ultimoError: string | null = null;

  async function pasada(): Promise<void> {
    /* Sin solape: una pasada lenta (pulse tardando) no acumula la siguiente. */
    if (corriendo) return;
    corriendo = true;
    try {
      for (const tab of TABS_RECURSOS) {
        try {
          const snap = await op.fuentes[tab]();
          if (!snap) continue;
          const r = muestraDeSnapshot(snap, disco.get(tab) ?? null, ahora());
          disco.set(tab, r.disco);
          op.historial.anotar(tab, r.muestra);
          if (tab === 'vps') op.sitiosVps?.(snap);
          muestras += 1;
        } catch (e) {
          /* Una fuente caída no tumba la otra ni la pasada entera. */
          ultimoError = e instanceof Error ? e.message : String(e);
        }
      }
      pasadas += 1;
    } finally {
      corriendo = false;
    }
  }

  function programar(): void {
    if (detenido) return;
    temporizador = setTimeout(() => {
      temporizador = null;
      void pasada().finally(() => programar());
    }, intervalo);
    /* Un temporizador de fondo no debe mantener vivo el proceso. */
    (temporizador as { unref?: () => void }).unref?.();
  }

  return {
    /* Arranca ya (una primera muestra al abrir el tablero) y sigue por su cuenta. */
    arrancar: () => {
      if (detenido) return;
      void pasada().finally(() => programar());
    },
    /* Una pasada suelta, sin temporizador: la usan las pruebas y un refresco forzado. */
    muestrearAhora: pasada,
    detener: () => {
      detenido = true;
      if (temporizador !== null) {
        clearTimeout(temporizador);
        temporizador = null;
      }
    },
    estado: (): EstadoMuestreo => ({ pasadas, muestras, ultimoError, detenido }),
  };
}

/* Fuentes de producción: los dos pulses que el tablero ya consulta (el de la VPS 66
 * por `PULSE_URL` y el del taller de la 89 por el túnel local). Ninguna añade una
 * conexión nueva: son los mismos clientes con caché y breaker. */
function fuentesProd(): Record<TabRecursos, () => Promise<VpsAgenteSnapshot | null>> {
  return {
    vps: async () => (await agenteProd()?.snapshot())?.snapshot ?? null,
    taller: async () => (await agenteTaller()?.snapshot())?.snapshot ?? null,
  };
}

let prod: ReturnType<typeof crearMuestreador> | null = null;

/* Singleton de producción: el servidor directo lo arranca una vez (index.ts). */
export function muestreadorProd(): ReturnType<typeof crearMuestreador> {
  if (!prod) {
    prod = crearMuestreador({
      historial: historialRecursosProd(),
      fuentes: fuentesProd(),
      sitiosVps: anotarSitiosVps,
    });
  }
  return prod;
}

